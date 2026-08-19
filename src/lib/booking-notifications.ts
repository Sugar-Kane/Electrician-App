import "server-only";

import {
  confirmationEmail,
  customerConfirmationSms,
  emailSender,
  looksLikeEmail,
  ownerBookingEmail,
  ownerBookingSms,
  ownerIntakeSms,
  type BookingFacts,
} from "@/lib/booking-confirmation";
import { sendEmail } from "@/lib/email";
import { slotLabel } from "@/lib/intake-shared";
import { type IntakeContext } from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

/**
 * Telling everyone who needs to know that a booking happened.
 *
 * Four things, in order of who is worst off without them: the customer, who
 * otherwise has only a memory of a phone call; and the owner, who otherwise
 * finds out by opening the app.
 *
 * Every send is best-effort and independent. A booking is already in the
 * calendar by the time this runs, and no delivery failure may undo it — an
 * unregistered A2P campaign, a mistyped email, or a provider outage each cost a
 * message, never the appointment. Failures are recorded on the message row so
 * they are visible the next morning rather than lost.
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

export type BookingNotification = {
  requestId: string;
  organizationId: string;
  customerId: string;
  publicToken: string;
  phone: string;
  email?: string;
  context: IntakeContext;
  contactName: string;
  description: string;
  address: { line1: string; city: string };
  slot: { start: string; end: string };
  timeZone: string;
  /** Origin for the confirmation link, e.g. https://www.volteira.com */
  origin: string;
  intakeAnswers?: { question: string; answer: string }[];
  /**
   * Where this business wants booking alerts sent.
   *
   * Per-business and nothing else. There is no deployment-wide fallback on
   * purpose — see the comment at the owner send below.
   */
  owner?: { email: string; phone: string };
  /** Where the customer asked to receive their link. */
  deliveryPreference?: "text" | "email" | "both";
  /** The job this became, for the link in the owner's email. */
  jobId?: string;
  /**
   * True when the customer has already been told, in a thread they are reading.
   *
   * A booking made over text ends with the assistant replying "booked for Tue,
   * 8-10am" in that same conversation. A second text a moment later saying the
   * same thing reads as a system malfunction, so the text path suppresses the
   * customer's copy and keeps everything else — the owner is the one who has
   * heard nothing.
   */
  customerAlreadyToldBySms?: boolean;
  /**
   * The slot is reserved and the fee is not paid yet.
   *
   * Only changes what the owner is told. A held time on his phone as "New
   * booking" is a day planned around an appointment that may never be paid for.
   */
  held?: boolean;
};

function factsFor(input: BookingNotification): BookingFacts {
  return {
    businessName: input.context.businessName,
    businessPhone: input.context.businessPhone,
    contactName: input.contactName,
    slotLabel: slotLabel(input.slot.start, input.slot.end, input.timeZone),
    addressLine1: input.address.line1,
    city: input.address.city,
    diagnosticFee: input.context.diagnosticFee,
    description: input.description,
    intakeAnswers: input.intakeAnswers,
    customerPhone: input.phone,
    link: input.origin ? `${input.origin.replace(/\/+$/, "")}/booking/${input.publicToken}` : undefined,
  };
}

/**
 * Record the outbound message so a failure is visible in the thread.
 *
 * A confirmation nobody received is exactly the thing a business needs to be
 * able to see, and `undelivered` with a carrier code is how they find out the
 * A2P campaign is still blocking them.
 */
async function recordOutbound(input: {
  database: Database;
  organizationId: string;
  customerId: string;
  body: string;
  result: Awaited<ReturnType<typeof sendSms>>;
}) {
  const { data: conversation } = await input.database
    .from("conversations")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("customer_id", input.customerId)
    .eq("channel", "sms")
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let conversationId = conversation?.id ? String(conversation.id) : "";
  if (!conversationId) {
    const { data: created } = await input.database
      .from("conversations")
      .insert({
        organization_id: input.organizationId,
        customer_id: input.customerId,
        channel: "sms",
        status: "open",
        last_message_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    conversationId = created?.id ? String(created.id) : "";
  }
  if (!conversationId) return;

  await input.database.from("messages").insert({
    organization_id: input.organizationId,
    conversation_id: conversationId,
    direction: "outbound",
    body: input.body,
    status: input.result.ok ? input.result.status : "failed",
    provider_message_id: input.result.ok ? input.result.providerMessageId : null,
    error_code: input.result.ok ? null : input.result.errorCode,
    error_detail: input.result.ok ? null : input.result.errorDetail,
  });
}

type Attempt = {
  channel: "sms" | "email";
  to: string;
  audience: "customer" | "owner";
  ok: boolean;
  detail?: string;
  at: string;
};

export async function sendBookingConfirmations(input: BookingNotification): Promise<void> {
  const database = getSupabaseAdmin();
  const facts = factsFor(input);
  const attempts: Attempt[] = [];

  const note = (attempt: Omit<Attempt, "at">) =>
    attempts.push({ ...attempt, at: new Date().toISOString() });

  // Claim the booking before sending. A retried tool call, or a model that
  // books twice, must not text the same customer about the same appointment
  // twice — and the claim is worth more than the send.
  const { data: claimed } = await database
    .from("booking_requests")
    .update({ confirmed_notified_at: new Date().toISOString() })
    .eq("id", input.requestId)
    .is("confirmed_notified_at", null)
    .select("id")
    .maybeSingle();

  if (!claimed) return;

  const { data: settings } = await database
    .from("messaging_settings")
    .select("messaging_service_sid")
    .eq("organization_id", input.organizationId)
    .maybeSingle();

  const messagingServiceSid = String(settings?.messaging_service_sid ?? "");

  // The customer. They gave this number on a call to book this appointment,
  // which is the transactional consent — recorded with that as the proof, the
  // same evidence an inbound text leaves.
  const preference = input.deliveryPreference ?? "text";
  const wantsText = preference === "text" || preference === "both";
  const wantsEmail = preference === "email" || preference === "both";

  if (input.customerAlreadyToldBySms) {
    note({
      channel: "sms",
      to: input.phone,
      audience: "customer",
      ok: true,
      detail: "Confirmed in the text thread itself; a second copy was not sent.",
    });
  } else if (messagingServiceSid && input.phone && wantsText) {
    await database.from("messaging_consent").upsert(
      {
        organization_id: input.organizationId,
        customer_id: input.customerId,
        channel: "sms",
        scope: "transactional",
        opted_in_at: new Date().toISOString(),
        opted_out_at: null,
        source: "phone_booking",
        proof_text: `Caller gave this number on a phone call to book ${facts.slotLabel}.`,
      },
      { onConflict: "customer_id,channel,scope" },
    );

    const body = customerConfirmationSms(facts);
    const result = await sendSms({ to: input.phone, body, messagingServiceSid });
    note({
      channel: "sms",
      to: input.phone,
      audience: "customer",
      ok: result.ok,
      detail: result.ok ? result.status : `${result.errorCode}: ${result.errorDetail}`,
    });
    await recordOutbound({
      database,
      organizationId: input.organizationId,
      customerId: input.customerId,
      body,
      result,
    });
  }

  // The owner. Deliberately a different number from the business line, so a
  // booking taken at 2am reaches a person rather than the phone that took it.
  //
  // This deliberately does NOT fall back to an environment variable. It used
  // to, so the one tenant already running would not go quiet before anybody had
  // filled the settings form in — which was safe at exactly one business and
  // becomes a data leak at two. A deployment-wide address is one address: the
  // second electrician's first booking, carrying their customer's name, street
  // address, phone number and problem, would be emailed and texted to the first
  // electrician. Going quiet is a bug somebody reports. Sending a stranger's
  // customer to the wrong contractor is not recoverable.
  //
  // A business with nothing set is recorded as such, and the support console
  // reports it as blocking.
  const ownerPhone = input.owner?.phone ?? "";
  if (messagingServiceSid && ownerPhone) {
    const sent = await sendSms({
      to: ownerPhone,
      body: ownerBookingSms(facts, input.held ?? false),
      messagingServiceSid,
    });
    note({
      channel: "sms",
      to: ownerPhone,
      audience: "owner",
      ok: sent.ok,
      detail: sent.ok ? sent.status : `${sent.errorCode}: ${sent.errorDetail}`,
    });

    const intake = ownerIntakeSms(facts);
    if (intake) await sendSms({ to: ownerPhone, body: intake, messagingServiceSid });
  } else if (!ownerPhone) {
    note({
      channel: "sms",
      to: "",
      audience: "owner",
      ok: false,
      detail:
        "This business has not set a booking-alert phone number. Set one at Settings \u2192 Booking alerts.",
    });
  }

  // The owner's email. While A2P blocks every text, this is the only thing that
  // actually reaches anybody, so it carries the whole work order rather than a
  // nudge to go and look.
  // Per-business only, for the same reason as the phone above.
  const ownerEmail = input.owner?.email ?? "";
  if (ownerEmail) {
    const jobUrl =
      input.origin && input.jobId
        ? `${input.origin.replace(/\/+$/, "")}/jobs/${input.jobId}`
        : undefined;
    const message = ownerBookingEmail(facts, jobUrl);
    const sent = await sendEmail({
      to: ownerEmail,
      subject: message.subject,
      text: message.text,
      html: message.html,
      from: emailSender(facts.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
    });
    note({
      channel: "email",
      to: ownerEmail,
      audience: "owner",
      ok: sent.ok,
      detail: sent.ok ? sent.id : `${sent.errorCode}: ${sent.errorDetail}`,
    });
  } else {
    note({
      channel: "email",
      to: "",
      audience: "owner",
      ok: false,
      detail:
        "This business has not set a booking-alert email address. Set one at Settings \u2192 Booking alerts.",
    });
  }

  // The email, when the caller gave one that could plausibly be delivered to.
  if (input.email && wantsEmail && looksLikeEmail(input.email)) {
    const message = confirmationEmail(facts);
    const sent = await sendEmail({
      to: input.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      // Signed by the business, not by the software that sent it.
      from: emailSender(facts.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
    });
    note({
      channel: "email",
      to: input.email,
      audience: "customer",
      ok: sent.ok,
      detail: sent.ok ? sent.id : `${sent.errorCode}: ${sent.errorDetail}`,
    });
  }

  // Written last and never allowed to fail the call: this is the record of what
  // was attempted, and it is the answer to "was anybody actually told?".
  try {
    await database
      .from("booking_requests")
      .update({ notification_results: attempts })
      .eq("id", input.requestId);
  } catch {
    // Deliberately silent.
  }
}
