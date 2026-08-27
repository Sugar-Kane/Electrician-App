import "server-only";

import { sendBookingConfirmations, sendCallbackAlert } from "@/lib/booking-notifications";
import { readInboundText, type IntakeTurn } from "@/lib/claude";
import { HOLD_MINUTES, heldReply } from "@/lib/booking-hold";
import { readLanguage, readLanguageSource } from "@/lib/customer-language";
import { localeFor } from "@/lib/intake-phrases";
import {
  loadIntakeContext,
  recordBookingRequest,
  recordDetectedLanguage,
  slotLabel,
} from "@/lib/intake-shared";
import {
  buildIntakeSystemPrompt,
  decideIntakeAction,
  splitName,
  type IntakeAction,
} from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

/**
 * Answer an inbound customer text, and schedule from it when there is enough
 * to schedule on.
 *
 * Runs from the Twilio webhook, so there is no session: it uses the service
 * role and scopes every read and write by the organization the message
 * arrived for.
 *
 * Never throws. The customer's message has already been recorded by the time
 * this runs; a model outage or a Twilio failure must not undo that.
 */

export type IntakeOutcome =
  | { handled: false; reason: string }
  | { handled: true; action: IntakeAction["kind"]; requestId?: string; jobId?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const MAX_HISTORY_TURNS = 20;

export async function handleInboundText(input: {
  organizationId: string;
  conversationId: string;
  customerId: string;
  phone: string;
  body: string;
}): Promise<IntakeOutcome> {
  try {
    const database = getSupabaseAdmin();

    const [{ data: history }, { data: customer }] = await Promise.all([
      database
        .from("messages")
        .select("direction, body, created_at")
        .eq("conversation_id", input.conversationId)
        .order("created_at", { ascending: false })
        .limit(MAX_HISTORY_TURNS),
      database
        .from("customers")
        .select("preferred_language, language_source")
        .eq("id", input.customerId)
        .maybeSingle(),
    ]);

    const { context, messagingServiceSid, timeZone, owner } = await loadIntakeContext({
      database,
      organizationId: input.organizationId,
      // The opt-out rides the first thing this system ever says to them.
      isFirstReply: (history ?? []).every((row) => row.direction === "inbound"),
      // What we believed before this message. `decideIntakeAction` applies the
      // detection to it and hands back what to say and what to store.
      language: readLanguage(customer?.preferred_language),
      languageSource: readLanguageSource(customer?.language_source),
    });

    const turns: IntakeTurn[] = (history ?? [])
      .slice()
      .reverse()
      .map((row) => ({
        role: row.direction === "inbound" ? ("user" as const) : ("assistant" as const),
        text: text(row.body),
      }))
      .filter((turn) => turn.text.length > 0);

    // The conversation must start with the customer, and the newest inbound
    // message is the one being answered.
    while (turns.length > 0 && turns[0]!.role !== "user") turns.shift();
    if (turns.length === 0 || turns[turns.length - 1]!.text !== input.body) {
      turns.push({ role: "user", text: input.body });
    }

    const decision = await readInboundText({
      system: buildIntakeSystemPrompt(context),
      turns,
    });

    const action = decideIntakeAction({ decision, customerText: input.body, context });

    await Promise.all([
      recordExtractedName(database, input.customerId, action),
      recordDetectedLanguage(database, input.customerId, action),
    ]);

    const recorded = await recordBookingRequest({
      database,
      organizationId: input.organizationId,
      customerId: input.customerId,
      phone: input.phone,
      channel: "sms",
      conversationId: input.conversationId,
      action,
      callerText: input.body,
      model: decision ? "claude-opus-5" : null,
      decision,
      // Collected in the thread and carried through, so a text booking lands
      // with the same intake a phone booking does rather than an address and a
      // sentence.
      intakeAnswers: action.kind === "book" ? action.intakeAnswers : undefined,
      deliveryPreference: action.kind === "book" ? action.deliveryPreference : undefined,
      // Quoted here so it is frozen against this booking. Without it the fee
      // was stated in the conversation, agreed to in principle, and recorded
      // nowhere — which is also why nothing was ever held for payment.
      depositCents: action.kind === "book" ? context.diagnosticFeeCents : undefined,
    });

    const { requestId, jobId, publicToken } = recorded;

    /*
     * A held time is not a booked one, and must not be told to the customer as
     * though it were. The intake composes "booked for Thursday 8-10am"; when
     * the slot is only reserved until the fee is paid, that sentence is
     * replaced rather than appended to.
     */
    const held =
      action.kind === "book" && recorded.payUrl && recorded.feeCents
        ? heldReply({
            businessName: context.businessName,
            slotLabel: slotLabel(
              action.slot.start,
              action.slot.end,
              timeZone,
              new Date().toISOString(),
              localeFor(action.language),
            ),
            feeCents: recorded.feeCents,
            payUrl: recorded.payUrl,
            holdMinutes: HOLD_MINUTES,
            businessPhone: context.businessPhone,
            language: action.language,
          })
        : "";

    await replyToCustomer({
      database,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      to: input.phone,
      body: held || action.reply,
      messagingServiceSid,
    });

    // Tell the owner. A booking taken by text used to tell nobody at all: the
    // customer got the assistant's reply in the thread and the electrician
    // found out by opening the app, which for a job at 8am the next morning is
    // too late to be a notification. The customer's copy is suppressed because
    // they have just read it in this very conversation.
    if (action.kind === "book" && requestId && publicToken) {
      await sendBookingConfirmations({
        requestId,
        organizationId: input.organizationId,
        customerId: input.customerId,
        publicToken,
        phone: input.phone,
        context,
        contactName: action.contactName,
        description: action.description,
        address: { line1: action.address.line1, city: action.address.city },
        slot: { start: action.slot.start, end: action.slot.end },
        timeZone,
        origin: process.env.NEXT_PUBLIC_APP_URL ?? "",
        jobId,
        owner,
        intakeAnswers: action.intakeAnswers,
        deliveryPreference: action.deliveryPreference,
        customerAlreadyToldBySms: true,
        held: Boolean(recorded.payUrl),
      });
    }

    /*
     * And the callback, for the same reason one line up.
     *
     * The conversation below is marked `needs_human`, which is a flag on a list
     * somebody has to go and look at. That is not a notification either, and a
     * customer who has just been told an electrician will call them back is
     * relying on somebody being told.
     *
     * `when` is "later" on this path: a text conversation is not somebody
     * waiting on the line, and the tool that asks the question is the voice
     * one. If the text assistant ever learns to ask, it passes it here.
     */
    if (action.kind === "callback" && requestId && !recorded.alreadyExisted) {
      await sendCallbackAlert({
        requestId,
        organizationId: input.organizationId,
        customerId: input.customerId,
        phone: input.phone,
        contactName: action.contactName,
        description: action.description,
        urgency: action.urgency ?? "routine",
        when: "later",
        context,
        owner,
        origin: process.env.NEXT_PUBLIC_APP_URL ?? "",
        customerAlreadyToldBySms: true,
      });
    }

    await database
      .from("conversations")
      .update({
        // A callback needs a person. A booked visit, or a
        // question the customer still has to answer, does not.
        status: action.kind === "callback" ? "needs_human" : "open",
        escalation_reason: null,
      })
      .eq("id", input.conversationId);

    return { handled: true, action: action.kind, requestId, jobId };
  } catch {
    return { handled: false, reason: "Intake failed." };
  }
}

async function recordExtractedName(
  database: ReturnType<typeof getSupabaseAdmin>,
  customerId: string,
  action: IntakeAction,
) {
  if (action.kind === "ask") return;
  const name = action.contactName?.trim();
  if (!name) return;

  const { data: customer } = await database
    .from("customers")
    .select("first_name")
    .eq("id", customerId)
    .maybeSingle();

  // Only fill in the placeholder the webhook created; never rename a customer
  // the business entered themselves.
  if (text(customer?.first_name) !== "Text") return;

  const { first, last } = splitName(name);
  await database
    .from("customers")
    .update({ first_name: first || "Text", last_name: last || null })
    .eq("id", customerId);
}

async function replyToCustomer(input: {
  database: ReturnType<typeof getSupabaseAdmin>;
  organizationId: string;
  conversationId: string;
  to: string;
  body: string;
  messagingServiceSid: string;
}) {
  const { data: inserted } = await input.database
    .from("messages")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId,
      direction: "outbound",
      body: input.body,
      status: input.messagingServiceSid ? "sending" : "failed",
      error_detail: input.messagingServiceSid ? null : "No messaging service configured.",
    })
    .select("id")
    .single();

  if (!inserted || !input.messagingServiceSid) return;
  const messageId = String(inserted.id);

  const origin = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  const result = await sendSms({
    to: input.to,
    body: input.body,
    messagingServiceSid: input.messagingServiceSid,
    statusCallbackUrl: origin ? `${origin}/api/twilio/status?message=${messageId}` : undefined,
  });

  await input.database
    .from("messages")
    .update(
      result.ok
        ? { status: "sent", provider_message_id: result.providerMessageId, sent_at: new Date().toISOString() }
        : { status: "failed", error_code: result.errorCode, error_detail: result.errorDetail },
    )
    .eq("id", messageId);

  if (result.ok) {
    await input.database
      .from("conversations")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", input.conversationId);
  }
}
