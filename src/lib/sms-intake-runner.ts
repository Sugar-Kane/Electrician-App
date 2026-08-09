import "server-only";

import { readInboundText, type IntakeTurn } from "@/lib/claude";
import {
  buildIntakeSystemPrompt,
  decideIntakeAction,
  splitName,
  type IntakeAction,
  type IntakeContext,
  type OfferedSlot,
} from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";
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

/** "Tue Aug 11, 8:00-10:00 AM", in the business's timezone. */
function slotLabel(start: string, end: string, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(start));
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    );
  return `${day}, ${time(start)}-${time(end)}`;
}

const MAX_OFFERED_SLOTS = 6;
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

    const [{ data: organization }, { data: settings }, { data: messaging }, { data: history }] =
      await Promise.all([
        database
          .from("organizations")
          .select("name, phone, slug, timezone")
          .eq("id", input.organizationId)
          .maybeSingle(),
        database
          .from("service_settings")
          .select("diagnostic_fee_cents, automatic_booking_radius_miles")
          .eq("organization_id", input.organizationId)
          .maybeSingle(),
        database
          .from("messaging_settings")
          .select("messaging_service_sid")
          .eq("organization_id", input.organizationId)
          .maybeSingle(),
        database
          .from("messages")
          .select("direction, body, created_at")
          .eq("conversation_id", input.conversationId)
          .order("created_at", { ascending: false })
          .limit(MAX_HISTORY_TURNS),
      ]);

    const timeZone = text(organization?.timezone) || DEFAULT_TIMEZONE;
    const businessName = text(organization?.name) || "Your electrician";
    const businessPhone = text(organization?.phone);
    const slug = text(organization?.slug);

    // Only ever offer windows the scheduler says are open. This is the same
    // function the public booking page reads, so the model cannot offer a time
    // the business has already filled.
    let offeredSlots: OfferedSlot[] = [];
    if (slug) {
      const { data: slots } = await database.rpc("list_public_booking_slots", {
        p_slug: slug,
        p_from_date: new Date().toISOString().slice(0, 10),
        p_days: 14,
      });
      offeredSlots = ((slots as { slot_start: string; slot_end: string }[] | null) ?? [])
        .slice(0, MAX_OFFERED_SLOTS)
        .map((slot) => ({
          start: slot.slot_start,
          end: slot.slot_end,
          label: slotLabel(slot.slot_start, slot.slot_end, timeZone),
        }));
    }

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

    const context: IntakeContext = {
      businessName,
      businessPhone: businessPhone || "our office",
      offeredSlots,
      diagnosticFee:
        typeof settings?.diagnostic_fee_cents === "number"
          ? `$${(settings.diagnostic_fee_cents / 100).toFixed(0)}`
          : "quoted before we come out",
      serviceArea: `${settings?.automatic_booking_radius_miles ?? 50} miles of the shop`,
      // The opt-out rides the first thing this system ever says to them.
      isFirstReply: (history ?? []).every((row) => row.direction === "inbound"),
    };

    const decision = await readInboundText({
      system: buildIntakeSystemPrompt(context),
      turns,
    });

    const action = decideIntakeAction({ decision, customerText: input.body, context });

    await recordExtractedName(database, input.customerId, action);

    let requestId: string | undefined;
    let jobId: string | undefined;

    if (action.kind === "callback" || action.kind === "book" || action.kind === "escalate") {
      const { data: created } = await database
        .from("sms_booking_requests")
        .insert({
          organization_id: input.organizationId,
          conversation_id: input.conversationId,
          customer_id: input.customerId,
          intent:
            action.kind === "book" ? "visit" : action.kind === "escalate" ? "emergency" : "callback",
          phone: input.phone,
          contact_name: action.kind === "escalate" ? null : action.contactName || null,
          description:
            action.kind === "escalate"
              ? input.body.slice(0, 2000)
              : (action.description || input.body).slice(0, 2000),
          address_line_1: action.kind === "book" ? action.address.line1 : null,
          city: action.kind === "book" ? action.address.city : null,
          postal_code:
            action.kind === "book" && /^[0-9]{5}(-[0-9]{4})?$/.test(action.address.postalCode)
              ? action.address.postalCode
              : null,
          arrival_window_start: action.kind === "book" ? action.slot.start : null,
          arrival_window_end: action.kind === "book" ? action.slot.end : null,
          urgency: action.kind === "escalate" ? "urgent" : action.urgency ?? "routine",
          safety_flags: action.kind === "escalate" ? action.hazards : [],
          model: decision ? "claude-opus-5" : null,
          model_decision: decision ?? {},
        })
        .select("id")
        .single();

      requestId = created?.id ? String(created.id) : undefined;

      // A window the scheduler offered and the customer accepted becomes a job
      // straight away — that is the whole point of booking by text. Everything
      // else waits for a person.
      if (action.kind === "book" && requestId) {
        const { data: scheduled } = await database.rpc("schedule_sms_booking_request", {
          p_request_id: requestId,
        });
        jobId = typeof scheduled === "string" ? scheduled : undefined;
      }
    }

    await replyToCustomer({
      database,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      to: input.phone,
      body: action.reply,
      messagingServiceSid: text(messaging?.messaging_service_sid),
    });

    await database
      .from("conversations")
      .update({
        // An emergency or a callback needs a person. A booked visit, or a
        // question the customer still has to answer, does not.
        status: action.kind === "escalate" || action.kind === "callback" ? "needs_human" : "open",
        escalation_reason:
          action.kind === "escalate" ? `Safety: ${action.hazards.join(", ") || "reported hazard"}` : null,
      })
      .eq("id", input.conversationId);

    return { handled: true, action: action.kind, requestId, jobId };
  } catch {
    return { handled: false, reason: "Intake failed." };
  }
}

/** Put a name on the lead as soon as the customer gives one. */
async function recordExtractedName(
  database: ReturnType<typeof getSupabaseAdmin>,
  customerId: string,
  action: IntakeAction,
) {
  if (action.kind === "escalate" || action.kind === "ask") return;
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
