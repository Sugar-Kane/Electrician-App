import "server-only";

import { type IntakeAction, type IntakeContext, type OfferedSlot } from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * The parts of customer intake that do not care whether the customer typed or
 * spoke: what the business is, what the schedule really has open, and how a
 * decision becomes a booking request.
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

const MAX_OFFERED_SLOTS = 6;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** "Tue Aug 11, 8:00-10:00 AM", in the business's timezone. */
export function slotLabel(start: string, end: string, timeZone: string): string {
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

export type LoadedContext = {
  context: IntakeContext;
  timeZone: string;
  messagingServiceSid: string;
};

/**
 * Everything the model needs to answer one customer, including the only
 * arrival windows it is allowed to offer.
 */
export async function loadIntakeContext(input: {
  database: Database;
  organizationId: string;
  isFirstReply: boolean;
}): Promise<LoadedContext> {
  const { database, organizationId } = input;

  const [{ data: organization }, { data: settings }, { data: messaging }] = await Promise.all([
    database
      .from("organizations")
      .select("name, phone, slug, timezone")
      .eq("id", organizationId)
      .maybeSingle(),
    database
      .from("service_settings")
      .select("diagnostic_fee_cents, automatic_booking_radius_miles")
      .eq("organization_id", organizationId)
      .maybeSingle(),
    database
      .from("messaging_settings")
      .select("messaging_service_sid")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);

  const timeZone = text(organization?.timezone) || DEFAULT_TIMEZONE;
  const slug = text(organization?.slug);

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

  return {
    timeZone,
    messagingServiceSid: text(messaging?.messaging_service_sid),
    context: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      offeredSlots,
      diagnosticFee:
        typeof settings?.diagnostic_fee_cents === "number"
          ? `$${(settings.diagnostic_fee_cents / 100).toFixed(0)}`
          : "quoted before we come out",
      serviceArea: `${settings?.automatic_booking_radius_miles ?? 50} miles of the shop`,
      isFirstReply: input.isFirstReply,
    },
  };
}

/**
 * Find the business a caller reached, by the number they dialled.
 *
 * Matched on the last ten digits, because the number Twilio delivers is E.164
 * and the number a business typed into its profile rarely is.
 */
export async function organizationForPhoneNumber(
  database: Database,
  dialled: string,
): Promise<string | null> {
  const digits = dialled.replace(/\D/g, "").slice(-10);
  if (digits.length < 10) return null;

  const { data } = await database
    .from("organizations")
    .select("id, phone")
    .is("archived_at", null)
    .limit(500);

  const match = (data ?? []).find(
    (row) => text(row.phone).replace(/\D/g, "").slice(-10) === digits,
  );
  return match ? String(match.id) : null;
}

/** Find the customer this number belongs to, or open a lead for them. */
export async function findOrCreateCustomerByPhone(input: {
  database: Database;
  organizationId: string;
  phone: string;
  note: string;
}): Promise<string | null> {
  const digits = input.phone.replace(/\D/g, "").slice(-10);

  const { data: customers } = await input.database
    .from("customers")
    .select("id, phone")
    .eq("organization_id", input.organizationId)
    .is("archived_at", null)
    .limit(5000);

  const existing = (customers ?? []).find(
    (row) => text(row.phone).replace(/\D/g, "").slice(-10) === digits && digits.length === 10,
  );
  if (existing) return String(existing.id);

  const { data: lead } = await input.database
    .from("customers")
    .insert({
      organization_id: input.organizationId,
      customer_type: "residential",
      first_name: "Text",
      last_name: digits.slice(-4) || null,
      phone: input.phone,
      preferred_contact: "sms",
      notes: input.note,
    })
    .select("id")
    .single();

  return lead ? String(lead.id) : null;
}

export type RecordedRequest = { requestId?: string; jobId?: string };

/**
 * Write down what the customer asked for, and turn an accepted window into a
 * job.
 *
 * The booking half runs only for `book`, which the rules module returns solely
 * when the customer accepted a window the scheduler itself offered.
 */
export async function recordBookingRequest(input: {
  database: Database;
  organizationId: string;
  customerId: string;
  phone: string;
  conversationId?: string | null;
  action: IntakeAction;
  callerText: string;
  model: string | null;
  decision: unknown;
}): Promise<RecordedRequest> {
  const { action } = input;
  if (action.kind !== "callback" && action.kind !== "book" && action.kind !== "escalate") {
    return {};
  }

  const { data: created } = await input.database
    .from("sms_booking_requests")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId ?? null,
      customer_id: input.customerId,
      intent: action.kind === "book" ? "visit" : action.kind === "escalate" ? "emergency" : "callback",
      phone: input.phone,
      contact_name: action.kind === "escalate" ? null : action.contactName || null,
      description:
        action.kind === "escalate"
          ? input.callerText.slice(0, 2000)
          : (action.description || input.callerText).slice(0, 2000),
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
      model: input.model,
      model_decision: input.decision ?? {},
    })
    .select("id")
    .single();

  const requestId = created?.id ? String(created.id) : undefined;
  if (action.kind !== "book" || !requestId) return { requestId };

  const { data: scheduled } = await input.database.rpc("schedule_sms_booking_request", {
    p_request_id: requestId,
  });

  return { requestId, jobId: typeof scheduled === "string" ? scheduled : undefined };
}
