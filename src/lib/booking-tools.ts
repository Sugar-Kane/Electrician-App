import "server-only";

import { after } from "next/server";

import {
  BOOKING_TOOLS,
  buildDecision,
  callbackShortfall,
  callbackWhen,
  callerEmail,
  callerPhone,
  customerWords,
  deliveryPreference,
  describeOutcome,
  intakeAnswers,
  intakeQuestionList,
  intakeShortfall,
  slotList,
  unreachableCaller,
} from "@/lib/booking-tool-rules";
import {
  sendBookingConfirmations,
  sendCallbackAlert,
} from "@/lib/booking-notifications";
import {
  findOrCreateCustomerByPhone,
  loadIntakeContext,
  recordBookingRequest,
} from "@/lib/intake-shared";
import { type ToolResult } from "@/lib/mcp-protocol";
import { type McpSession } from "@/lib/mcp-session-token";
import { decideIntakeAction } from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { recordActivity } from "@/lib/activity";
import { toE164 } from "@/lib/phone-format";
import { findActiveInboundTwilioCall, redirectTwilioCall } from "@/lib/twilio";
import { liveTransferTwiml, transferActionUrl } from "@/lib/twilio-transfer";

/**
 * Running a booking tool against the real schedule.
 *
 * Deliberately thin: the rules, the tool definitions, and every word sent back
 * to the model live in booking-tool-rules, where they are tested. What is left
 * here is the part that needs a database — load the context, run the proposal
 * past `decideIntakeAction`, write whatever it approved.
 */

export { BOOKING_TOOLS };

type Database = ReturnType<typeof getSupabaseAdmin>;

/**
 * Who this booking belongs to.
 *
 * A per-call URL already knows. A console-configured one does not, so it falls
 * back to the number the model was told to collect — the organization is pinned
 * either way, which is the guarantee that actually matters.
 */
async function resolveCustomer(input: {
  database: Database;
  session: McpSession;
  args: Record<string, unknown>;
}): Promise<{ customerId: string; phone: string }> {
  if (input.session.customerId) {
    return {
      customerId: input.session.customerId,
      phone: input.session.phone ?? "",
    };
  }

  const phone = callerPhone(input.args);
  if (!phone) return { customerId: "", phone: "" };

  const customerId = await findOrCreateCustomerByPhone({
    database: input.database,
    organizationId: input.session.organizationId,
    phone,
    note: "Created from an inbound phone call.",
    channel: "phone",
    contactName:
      typeof input.args.contact_name === "string"
        ? input.args.contact_name
        : "",
  });

  return { customerId: customerId ?? "", phone };
}

export async function runBookingTool(input: {
  database: Database;
  session: McpSession;
  name: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const { context, timeZone, owner } = await loadIntakeContext({
    database: input.database,
    organizationId: input.session.organizationId,
    // A phone call has no thread and sends no SMS, so the opt-out footer that
    // belongs on a first text has no place in anything said out loud.
    isFirstReply: false,
  });

  if (input.name === "list_open_slots") return { text: slotList(context) };
  if (input.name === "get_intake_questions")
    return { text: intakeQuestionList() };

  // Before anything is written: was the customer actually interviewed, and did
  // they actually say yes? Both are refusals the model can act on, not errors.
  if (input.name === "book_visit") {
    const shortfall = intakeShortfall(input.args);
    if (shortfall) return { isError: true, text: shortfall };
  }

  // And on a callback: did the customer actually get to choose? A caller with
  // no power who wanted somebody now, filed as a routine callback because
  // nobody asked, is the whole reason this is a refusal and not a default.
  if (input.name === "request_callback") {
    const shortfall = callbackShortfall(input.args);
    if (shortfall) return { isError: true, text: shortfall };
  }

  /*
   * A visit nobody can be told about is worse than a refusal, and so is a
   * callback to a number that does not exist.
   *
   * Only checked when the number is the only handle we have on this caller: a
   * per-call URL already carries the customer, so a session-scoped booking is
   * unaffected. Refused before anything is written, because the model is still
   * on the phone with them and asking again costs nothing.
   */
  if (
    !input.session.customerId &&
    (input.name === "book_visit" || input.name === "request_callback")
  ) {
    const unreachable = unreachableCaller(input.name, input.args);
    if (unreachable) return { isError: true, text: unreachable };
  }

  const decision = buildDecision(input.name, input.args);
  if (!decision)
    return { isError: true, text: `NOT BOOKED. Unknown tool: ${input.name}` };

  const callerText = customerWords(input.args);
  const action = decideIntakeAction({
    decision,
    customerText: callerText,
    context,
  });

  const { customerId, phone } = await resolveCustomer({
    database: input.database,
    session: input.session,
    args: input.args,
  });

  if (!customerId) {
    return {
      isError: true,
      text: "NOT BOOKED. Ask the caller for the best phone number to reach them on, then call this again with caller_phone set.",
    };
  }

  const email = callerEmail(input.args);
  const answers = intakeAnswers(input.args);
  const preference = deliveryPreference(input.args);
  // Which the caller chose when asked. Refused above unless they were.
  const chosen = callbackWhen(input.args);
  const recorded = await recordBookingRequest({
    database: input.database,
    organizationId: input.session.organizationId,
    customerId,
    phone,
    // The realtime voice model books through these tools, so this is a
    // call however the words got to it.
    channel: "phone",
    action,
    callerText,
    model: "grok-voice",
    decision,
    email,
    intakeAnswers: answers,
    deliveryPreference: preference || undefined,
    depositCents: context.diagnosticFeeCents,
  });

  /*
   * Tell the customer and the owner, after the model has its answer.
   *
   * This was awaited, on the reasoning that a serverless invocation must not be
   * torn down mid-send. That is right, and `after` is how it is done: the work
   * runs once the response is flushed and is bounded by the route's
   * `maxDuration`, rather than holding the tool call open for the second or so
   * that Twilio and Resend take. A five second `book_visit` is what a realtime
   * client sits and waits through, and what it eventually gives up on.
   *
   * `alreadyExisted` is the other half. The booking was there before this call
   * and somebody has already been told about it; sending again is precisely the
   * thing that put thirteen texts on the owner's phone.
   *
   * Every failure inside is still swallowed. The appointment is in the calendar
   * and no delivery problem may unmake it.
   */
  if (
    action.kind === "book" &&
    recorded.requestId &&
    recorded.publicToken &&
    !recorded.alreadyExisted
  ) {
    const confirmations = {
      requestId: recorded.requestId,
      organizationId: input.session.organizationId,
      customerId,
      publicToken: recorded.publicToken,
      phone,
      email,
      context,
      contactName: action.contactName,
      description: action.description,
      address: { line1: action.address.line1, city: action.address.city },
      slot: { start: action.slot.start, end: action.slot.end },
      timeZone,
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "",
      intakeAnswers: answers,
      deliveryPreference: preference || "text",
      jobId: recorded.jobId,
      owner,
      held: Boolean(recorded.payUrl),
    };

    after(() => sendBookingConfirmations(confirmations));
  }

  /*
   * And the callback, which used to tell nobody at all.
   *
   * The send was gated on `action.kind === "book"`, so the one outcome that
   * exists because a person has to ring somebody back was the one outcome no
   * person heard about. A caller was promised a call back and the promise
   * reached the database and stopped there.
   */
  if (
    action.kind === "callback" &&
    recorded.requestId &&
    !recorded.alreadyExisted
  ) {
    const alert = {
      requestId: recorded.requestId,
      organizationId: input.session.organizationId,
      customerId,
      phone,
      contactName: action.contactName,
      description: action.description,
      urgency: action.urgency ?? ("routine" as const),
      when: chosen || ("later" as const),
      context,
      intakeAnswers: answers,
      owner,
      origin: process.env.NEXT_PUBLIC_APP_URL ?? "",
    };

    after(() => sendCallbackAlert(alert));
  }

  let transfer: "started" | "unavailable" | undefined;
  if (action.kind === "callback" && chosen === "now") {
    transfer = "unavailable";
    const caller = toE164(input.session.phone ?? phone);
    const business = toE164(context.businessPhone);
    const electrician = toE164(owner.phone ?? "");
    const origin = process.env.NEXT_PUBLIC_APP_URL ?? "";

    if (
      recorded.requestId &&
      !recorded.alreadyExisted &&
      caller &&
      business &&
      electrician &&
      electrician !== caller &&
      electrician !== business
    ) {
      const call = await findActiveInboundTwilioCall({
        from: caller,
        to: business,
      });
      if (call) {
        const actionUrl = transferActionUrl({
          origin,
          callSid: call.sid,
          requestId: recorded.requestId,
          language: action.language,
        });
        const body = liveTransferTwiml({
          to: electrician,
          callerId: business,
          actionUrl,
          language: action.language,
        });
        if (body) {
          const redirected = await redirectTwilioCall({
            callSid: call.sid,
            twiml: body,
          });
          if (redirected.ok) {
            transfer = "started";
            await input.database.from("inbound_calls").upsert(
              {
                organization_id: input.session.organizationId,
                provider: "twilio",
                provider_call_id: call.sid,
                from_number: call.from,
                to_number: call.to,
                status: "transferring",
                started_at: call.startedAt,
              },
              { onConflict: "provider,provider_call_id" },
            );
            await recordActivity(input.database, {
              organizationId: input.session.organizationId,
              eventType: "booking.transfer_started",
              label: "Live transfer started",
              customerId,
              bookingRequestId: recorded.requestId,
              metadata: { provider_call_id: call.sid },
            });
          }
        }
      }
    }
  }

  return describeOutcome({
    name: input.name,
    action,
    context,
    phone,
    when: chosen,
    deliveryPreference: preference,
    held: Boolean(recorded.payUrl),
    transfer,
  });
}
