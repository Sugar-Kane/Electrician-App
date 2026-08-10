import "server-only";

import {
  confirmationEmail,
  customerConfirmationSms,
  emailSender,
  looksLikeEmail,
  ownerBookingSms,
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

export async function sendBookingConfirmations(input: BookingNotification): Promise<void> {
  const database = getSupabaseAdmin();
  const facts = factsFor(input);

  // Claim the booking before sending. A retried tool call, or a model that
  // books twice, must not text the same customer about the same appointment
  // twice — and the claim is worth more than the send.
  const { data: claimed } = await database
    .from("sms_booking_requests")
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
  if (messagingServiceSid && input.phone) {
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
  const ownerPhone = process.env.OWNER_NOTIFICATION_PHONE ?? process.env.ESCALATION_PHONE_NUMBER ?? "";
  if (messagingServiceSid && ownerPhone) {
    await sendSms({ to: ownerPhone, body: ownerBookingSms(facts), messagingServiceSid });
  }

  // The email, when the caller gave one that could plausibly be delivered to.
  if (input.email && looksLikeEmail(input.email)) {
    const message = confirmationEmail(facts);
    await sendEmail({
      to: input.email,
      subject: message.subject,
      text: message.text,
      html: message.html,
      // Signed by the business, not by the software that sent it.
      from: emailSender(facts.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
    });
  }
}
