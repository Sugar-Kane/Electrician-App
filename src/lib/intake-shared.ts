import "server-only";

import { calendarDate, nowLabel, slotLabel } from "@/lib/schedule-labels";
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

export { slotLabel };

export type LoadedContext = {
  context: IntakeContext;
  timeZone: string;
  messagingServiceSid: string;
  /** Where this business wants to hear about a booking. */
  owner: { email: string; phone: string };
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
      .select("name, phone, slug, timezone, owner_notification_email, owner_notification_phone")
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

  // The business's today, not the server's. Between five in the afternoon and
  // midnight Pacific the UTC date is already tomorrow, and asking from it
  // silently drops the rest of the working day.
  const nowIso = new Date().toISOString();
  const fromDate = calendarDate(nowIso, timeZone);

  let offeredSlots: OfferedSlot[] = [];
  if (slug) {
    const { data: slots } = await database.rpc("list_public_booking_slots", {
      p_slug: slug,
      p_from_date: fromDate,
      p_days: 14,
    });
    offeredSlots = ((slots as { slot_start: string; slot_end: string }[] | null) ?? [])
      // A window that has already started is not an offer. The scheduler works
      // in whole days, so the last filter on "has this passed?" belongs here.
      .filter((slot) => new Date(slot.slot_start).getTime() > Date.now())
      .slice(0, MAX_OFFERED_SLOTS)
      .map((slot) => ({
        start: slot.slot_start,
        end: slot.slot_end,
        label: slotLabel(slot.slot_start, slot.slot_end, timeZone, nowIso),
      }));
  }

  return {
    timeZone,
    messagingServiceSid: text(messaging?.messaging_service_sid),
    // Per business, and nothing else. There is deliberately no deployment-wide
    // fallback: one deployment serves many electricians, so a single address
    // here would send the second electrician's customer to the first. A
    // business that has set nothing is told nothing, and the support console
    // reports that as blocking.
    owner: {
      email: text(organization?.owner_notification_email),
      phone: text(organization?.owner_notification_phone),
    },
    context: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      offeredSlots,
      diagnosticFee:
        typeof settings?.diagnostic_fee_cents === "number"
          ? `$${(settings.diagnostic_fee_cents / 100).toFixed(0)}`
          : "quoted before we come out",
      diagnosticFeeCents:
        typeof settings?.diagnostic_fee_cents === "number" ? settings.diagnostic_fee_cents : 10000,
      serviceArea: `${settings?.automatic_booking_radius_miles ?? 50} miles of the shop`,
      nowLabel: nowLabel(nowIso, timeZone),
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
  /** How they reached us, which decides what the placeholder name reads as. */
  channel?: "sms" | "phone";
  /** Their name, if they have already said it. */
  contactName?: string;
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

  // Named by what they told us if they told us anything, and otherwise by how
  // they got in touch — a caller who says "Dana Reyes" should not end up in the
  // customer list as "Text 9985".
  const channel = input.channel ?? "sms";
  const given = (input.contactName ?? "").trim().split(/\s+/).filter(Boolean);
  const named = given.length > 0;

  const { data: lead } = await input.database
    .from("customers")
    .insert({
      organization_id: input.organizationId,
      customer_type: "residential",
      first_name: named ? given[0] : channel === "phone" ? "Caller" : "Text",
      last_name: named ? given.slice(1).join(" ") || null : digits.slice(-4) || null,
      phone: input.phone,
      preferred_contact: channel === "phone" ? "phone" : "sms",
      notes: input.note,
    })
    .select("id")
    .single();

  return lead ? String(lead.id) : null;
}

export type RecordedRequest = {
  requestId?: string;
  jobId?: string;
  /** The unguessable handle for this booking, safe to put in a message. */
  publicToken?: string;
};

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
  /** Where to send an email confirmation, if the customer offered one. */
  email?: string;
  /** What the customer was asked on the call, and what they said. */
  intakeAnswers?: { question: string; answer: string }[];
  deliveryPreference?: "text" | "email" | "both";
  /** The deposit as quoted to them, frozen at the moment they agreed. */
  depositCents?: number;
}): Promise<RecordedRequest> {
  const { action } = input;
  if (action.kind !== "callback" && action.kind !== "book") {
    return {};
  }

  const { data: created } = await input.database
    .from("booking_requests")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId ?? null,
      customer_id: input.customerId,
      intent: action.kind === "book" ? "visit" : "callback",
      phone: input.phone,
      contact_name: action.contactName || null,
      description: (action.description || input.callerText).slice(0, 2000),
      address_line_1: action.kind === "book" ? action.address.line1 : null,
      city: action.kind === "book" ? action.address.city : null,
      postal_code:
        action.kind === "book" && /^[0-9]{5}(-[0-9]{4})?$/.test(action.address.postalCode)
          ? action.address.postalCode
          : null,
      arrival_window_start: action.kind === "book" ? action.slot.start : null,
      arrival_window_end: action.kind === "book" ? action.slot.end : null,
      urgency: action.urgency ?? "routine",
      model: input.model,
      model_decision: input.decision ?? {},
      email: input.email || null,
      intake_answers: input.intakeAnswers ?? [],
      delivery_preference: input.deliveryPreference ?? null,
      deposit_cents: action.kind === "book" ? (input.depositCents ?? null) : null,
    })
    .select("id, public_token")
    .single();

  const requestId = created?.id ? String(created.id) : undefined;
  const publicToken = created?.public_token ? String(created.public_token) : undefined;
  if (action.kind !== "book" || !requestId) return { requestId, publicToken };

  const { data: scheduled } = await input.database.rpc("schedule_sms_booking_request", {
    p_request_id: requestId,
  });

  return {
    requestId,
    publicToken,
    jobId: typeof scheduled === "string" ? scheduled : undefined,
  };
}
