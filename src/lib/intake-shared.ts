import "server-only";

import { recordActivity } from "@/lib/activity";
import { decideHold, payLinkFor } from "@/lib/booking-hold";
import {
  readLanguage,
  readLanguageSource,
  type LanguageCode,
  type LanguageSource,
} from "@/lib/customer-language";
import { DEFAULT_DIAGNOSTIC_FEE_CENTS } from "@/lib/diagnostic-visit";
import { localeFor } from "@/lib/intake-phrases";
import { calendarDate, nowLabel, slotLabel } from "@/lib/schedule-labels";
import { type IntakeAction, type IntakeContext, type OfferedSlot } from "@/lib/sms-intake";
import { getStripe } from "@/lib/stripe";
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
  /**
   * What this customer's record says, when the caller knows who they are.
   *
   * Passed in rather than looked up here because this function is shared with
   * the phone path, where the caller may be nobody yet. Absent, both fall to
   * the defaults, which is exactly what every customer read before this.
   */
  language?: LanguageCode;
  languageSource?: LanguageSource;
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
        /*
         * Both wordings, built here because this is where the timezone and the
         * business's "now" are. Which one a customer reads is not known yet —
         * the language is settled after the model has looked at their message —
         * so the alternative is re-formatting a date in a module that has
         * neither. Six slots and two locales is twelve `Intl` calls behind a
         * database round trip.
         */
        labels: {
          en: slotLabel(slot.slot_start, slot.slot_end, timeZone, nowIso, localeFor("en")),
          es: slotLabel(slot.slot_start, slot.slot_end, timeZone, nowIso, localeFor("es")),
        },
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
        typeof settings?.diagnostic_fee_cents === "number"
          ? settings.diagnostic_fee_cents
          : DEFAULT_DIAGNOSTIC_FEE_CENTS,
      serviceArea: `${settings?.automatic_booking_radius_miles ?? 50} miles of the shop`,
      nowLabel: nowLabel(nowIso, timeZone),
      isFirstReply: input.isFirstReply,
      language: readLanguage(input.language),
      languageSource: readLanguageSource(input.languageSource),
    },
  };
}

/**
 * What a customer's record says about the language to use.
 *
 * The text path reads these two columns inline; the phone paths did not read
 * them at all, so `loadIntakeContext` fell to its English defaults on every
 * turn of every call. That is fine for one turn and wrong across a
 * conversation: a caller who has been speaking Spanish says "sí", the model
 * reports the turn as too short to judge, and with nothing remembered the
 * fallback is English.
 *
 * Returns the defaults for a caller who is nobody yet, which is the same thing
 * the phone paths did before and is correct: an unknown number has no language.
 */
export async function loadCustomerLanguage(
  database: Database,
  customerId: string,
): Promise<{ language: LanguageCode; languageSource: LanguageSource }> {
  if (!customerId) {
    return { language: readLanguage(undefined), languageSource: readLanguageSource(undefined) };
  }

  const { data } = await database
    .from("customers")
    .select("preferred_language, language_source")
    .eq("id", customerId)
    .maybeSingle();

  return {
    language: readLanguage(data?.preferred_language),
    languageSource: readLanguageSource(data?.language_source),
  };
}

/**
 * Remember the language, when it turned out to be a new one.
 *
 * Lifted out of the text runner so the phone shares it rather than growing a
 * second copy. The decision has already been made — `decideIntakeAction` ran
 * the detection through `resolveLanguage`, which is where the owner's pin wins
 * — so this writes what it was told and decides nothing itself.
 *
 * `languageChanged` is false for almost every turn, which is the point: the
 * language usually has not changed, and a write per inbound turn is a write per
 * inbound turn.
 *
 * The `language_source = 'detected'` filter is belt and braces against a race:
 * the owner could have pinned this customer between the read at the top of the
 * turn and this write, and their choice is not something a caller undoes.
 */
export async function recordDetectedLanguage(
  database: Database,
  customerId: string,
  action: IntakeAction,
) {
  if (!customerId || !action.languageChanged) return;

  await database
    .from("customers")
    .update({ preferred_language: action.language, language_source: "detected" })
    .eq("id", customerId)
    .eq("language_source", "detected");
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

  // Named by what they told us if they told us anything, and otherwise by how
  // they got in touch — a caller who says "Dana Reyes" should not end up in the
  // customer list as "Text 9985".
  const channel = input.channel ?? "sms";
  const given = (input.contactName ?? "").trim().split(/\s+/).filter(Boolean);
  const named = given.length > 0;

  /*
   * One statement, arbitrated by the database.
   *
   * This used to pull up to 5000 customer rows into the application, match them
   * in JavaScript, and insert if nothing matched — a read followed by a write
   * with nothing between them. Thirteen `book_visit` calls arriving at once all
   * read the same empty result and all inserted, so one phone call produced
   * thirteen customers, thirteen bookings and thirteen texts to the owner. No
   * amount of checking here could have caught that; only a unique index can,
   * and only the database can consult one.
   *
   * The RPC also removes the 5000-row scan, which was a real part of the five
   * seconds each of those calls took.
   */
  const { data, error } = await input.database.rpc("find_or_create_customer_by_phone", {
    p_organization_id: input.organizationId,
    p_phone: input.phone,
    p_first_name: named ? given[0] : channel === "phone" ? "Caller" : "Text",
    p_last_name: named ? given.slice(1).join(" ") || null : digits.slice(-4) || null,
    p_preferred_contact: channel === "phone" ? "phone" : "sms",
    p_notes: input.note,
  });

  if (error) {
    console.error("find_or_create_customer_by_phone failed", error);
    return null;
  }

  return typeof data === "string" ? data : null;
}

export type RecordedRequest = {
  requestId?: string;
  /** Set when the appointment became a job outright. Absent when it is held. */
  jobId?: string;
  /** The unguessable handle for this booking, safe to put in a message. */
  publicToken?: string;
  /** Where the customer pays. Set only when the slot is being held. */
  payUrl?: string;
  /** When the hold lapses, as an instant. */
  heldUntil?: string;
  /** What they owe to confirm it. */
  feeCents?: number;
  /**
   * This booking was already there, and this call did not make it.
   *
   * Set when the unique index refused a second live booking for the same
   * customer at the same window. The appointment is real and the caller should
   * be told it is booked — but nobody may be texted about it twice, which is
   * the whole reason the guard exists.
   */
  alreadyExisted?: boolean;
};

/**
 * Write down what the customer asked for, and turn an accepted window into a
 * job.
 *
 * The booking half runs only for `book`, which the rules module returns solely
 * when the customer accepted a window the scheduler itself offered.
 */
/**
 * The live booking this customer already has at this window.
 *
 * Only reached when the unique index has just refused an insert, so there is
 * one by definition. Rebuilt into the same shape a successful insert returns,
 * including the payment link, so the words said back to the caller are the same
 * whether they are hearing about the booking that was made or the one that
 * already existed.
 */
async function liveBookingAt(input: {
  database: Database;
  organizationId: string;
  customerId: string;
  action: IntakeAction;
}): Promise<RecordedRequest> {
  const { action } = input;
  if (action.kind !== "book") return {};

  const { data } = await input.database
    .from("booking_requests")
    .select("id, public_token, status, created_job_id, expires_at, deposit_cents")
    .eq("organization_id", input.organizationId)
    .eq("customer_id", input.customerId)
    .eq("arrival_window_start", action.slot.start)
    .eq("arrival_window_end", action.slot.end)
    .in("status", ["new", "needs_review", "awaiting_payment", "confirmed", "scheduled"])
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!data) return {};

  const row = data as Record<string, unknown>;
  const publicToken = text(row.public_token) || undefined;
  const held = text(row.status) === "awaiting_payment";

  return {
    requestId: text(row.id) || undefined,
    publicToken,
    jobId: text(row.created_job_id) || undefined,
    payUrl:
      held && publicToken
        ? payLinkFor(process.env.NEXT_PUBLIC_APP_URL ?? "", publicToken) || undefined
        : undefined,
    heldUntil: held ? text(row.expires_at) || undefined : undefined,
    feeCents: typeof row.deposit_cents === "number" ? row.deposit_cents : undefined,
  };
}

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
  /**
   * How the customer actually reached us.
   *
   * Required, and deliberately not defaulted: this function is shared by the
   * text intake and the phone intake, and for as long as it wrote nothing the
   * column fell to its `default 'sms'` — so every booking taken over the phone
   * was filed as a text message. A caller that forgets this now fails to
   * compile rather than quietly mislabelling a lead.
   */
  channel: "phone" | "sms";
}): Promise<RecordedRequest> {
  const { action } = input;
  if (action.kind !== "callback" && action.kind !== "book") {
    return {};
  }

  const { data: created, error: insertError } = await input.database
    .from("booking_requests")
    .insert({
      organization_id: input.organizationId,
      conversation_id: input.conversationId ?? null,
      customer_id: input.customerId,
      communication_channel: input.channel,
      // Both intakes that reach here are the AI receptionist. A booking typed
      // in by the business does not come through this function at all.
      created_by: "ai",
      // Kept in step so anything still reading the older column agrees with the
      // two that replaced it.
      source: input.channel === "phone" ? "voice" : "sms",
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
    .maybeSingle();

  /*
   * The database refused a second live booking for this customer at this
   * window, and it was right to.
   *
   * One phone call once produced thirteen of these in under a second, each with
   * byte-identical arguments, because the client fanned the same tool call out
   * across thirteen fresh sessions. Every one of them booked, and every one of
   * them texted the owner. The appointment the caller agreed to already exists,
   * so this returns it and says so, and the caller of this function sends
   * nothing.
   */
  if (insertError?.code === "23505") {
    return { ...(await liveBookingAt(input)), alreadyExisted: true };
  }

  if (insertError) {
    console.error("booking request insert failed", insertError);
    return {};
  }

  const requestId = created?.id ? String(created.id) : undefined;
  const publicToken = created?.public_token ? String(created.public_token) : undefined;

  /*
   * The first line of this customer's history.
   *
   * Written here rather than left to the scheduling function below, because a
   * callback never reaches that function and an inquiry that goes no further is
   * still something that happened — the timeline is a record of the customer,
   * not only of the customers who booked.
   *
   * Nothing is recorded about the fee here. The customer was told it, and being
   * told is not agreeing; the prompts do not yet ask for a yes, so writing one
   * down would be inventing consent.
   */
  if (requestId) {
    await recordActivity(input.database, {
      organizationId: input.organizationId,
      eventType: action.kind === "book" ? "booking.requested" : "booking.callback_requested",
      label: action.kind === "book" ? "Asked for an electrician" : "Asked for a callback",
      customerId: input.customerId,
      bookingRequestId: requestId,
      metadata: { via: input.channel === "phone" ? "voice" : "sms" },
    });
  }

  if (action.kind !== "book" || !requestId) return { requestId, publicToken };

  /*
   * Held, or booked outright.
   *
   * The web booking page has always reserved the slot, taken the fee, and only
   * then written a job. This path wrote the job immediately — same appointment,
   * same fee quoted, nothing collected. Now both channels produce a booking in
   * `awaiting_payment` and both are finished by the same Stripe webhook.
   *
   * `decideHold` is the one place that decides which, and its fallback is what
   * makes this unable to be worse than what it replaced: with no payment
   * provider there is no link to send, so it books exactly as before.
   */
  const decision = decideHold({
    intent: "book",
    depositCents: input.depositCents,
    paymentsAvailable: Boolean(getStripe()),
  });

  if (decision.kind === "hold") {
    const payUrl = publicToken
      ? payLinkFor(process.env.NEXT_PUBLIC_APP_URL ?? "", publicToken)
      : "";

    if (payUrl) {
      const heldUntil = new Date(Date.now() + decision.holdMinutes * 60_000).toISOString();

      await input.database
        .from("booking_requests")
        .update({ status: "awaiting_payment", expires_at: heldUntil })
        .eq("id", requestId);

      await recordActivity(input.database, {
        organizationId: input.organizationId,
        eventType: "booking.hold_placed",
        label: "Appointment held, waiting on the diagnostic fee",
        customerId: input.customerId,
        bookingRequestId: requestId,
        metadata: {
          amount_cents: decision.feeCents,
          via: input.channel === "phone" ? "voice" : "sms",
        },
      });

      return { requestId, publicToken, payUrl, heldUntil, feeCents: decision.feeCents };
    }

    /*
     * A fee to collect, a provider to collect it with, and nowhere to send the
     * customer. Booking it outright is still right — the appointment is real
     * and they are expecting it — but this is a misconfiguration rather than a
     * decision, and it is invisible from the outside: the booking just goes
     * back to being unpaid, exactly as it looked before any of this existed.
     */
    console.error(
      publicToken
        ? "booking hold skipped: NEXT_PUBLIC_APP_URL is not a usable https origin, so no payment link could be built"
        : "booking hold skipped: the booking row came back without a public token",
      { requestId, organizationId: input.organizationId, feeCents: decision.feeCents },
    );
  } else if ((input.depositCents ?? 0) > 0) {
    /*
     * A fee was quoted to this customer and nothing will be collected before
     * the visit. Expected where payments are not configured at all, which is
     * why it is the deliberate fallback — but a business that thinks it is
     * taking deposits should be able to find out that it is not.
     */
    console.warn(`booking hold skipped: ${decision.because}`, {
      requestId,
      organizationId: input.organizationId,
      depositCents: input.depositCents,
    });
  }

  const { data: scheduled } = await input.database.rpc("schedule_sms_booking_request", {
    p_request_id: requestId,
  });

  return {
    requestId,
    publicToken,
    jobId: typeof scheduled === "string" ? scheduled : undefined,
  };
}
