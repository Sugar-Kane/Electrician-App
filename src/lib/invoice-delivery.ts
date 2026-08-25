import "server-only";

import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { sendEmail } from "@/lib/email";
import {
  invoiceEmail,
  invoiceSms,
  type DeliveryAttempt,
  type DeliveryChannel,
  type InvoiceFacts,
} from "@/lib/invoice-messages";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

/**
 * Getting an invoice to the person who owes the money.
 *
 * Same shape as `notifyJobChange`, and for the same reasons: best effort, never
 * throws, and every attempt is written down — including the ones that are turned
 * away for want of a phone number. The public function validates channel names
 * at runtime because MCP/API inputs begin as strings even when in-app callers
 * have a narrower TypeScript union.
 */

export type { DeliveryAttempt, DeliveryChannel };

export async function deliverInvoice(input: {
  /** The row id, not the human invoice number. */
  invoiceId: string;
  organizationId: string;
  facts: InvoiceFacts;
  customerPhone: string;
  customerEmail: string;
  /** Which channels the sender asked for. Unknown channel strings are ignored. */
  channels: string[];
}): Promise<DeliveryAttempt[]> {
  const database = getSupabaseAdmin();
  const attempts: DeliveryAttempt[] = [];
  const note = (attempt: Omit<DeliveryAttempt, "at">) =>
    attempts.push({ ...attempt, at: new Date().toISOString() });

  const wants = new Set<DeliveryChannel>(
    input.channels.filter(
      (channel): channel is DeliveryChannel => channel === "sms" || channel === "email",
    ),
  );

  if (wants.has("sms")) {
    const { data: settings } = await database
      .from("messaging_settings")
      .select("messaging_service_sid")
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    const messagingServiceSid = String(settings?.messaging_service_sid ?? "");

    if (!messagingServiceSid) {
      note({
        channel: "sms",
        to: input.customerPhone,
        ok: false,
        detail: "This business has no messaging service, so no text could be sent.",
      });
    } else if (!input.customerPhone) {
      note({ channel: "sms", to: "", ok: false, detail: "No phone number on this customer." });
    } else {
      const result = await sendSms({
        to: input.customerPhone,
        body: invoiceSms(input.facts),
        messagingServiceSid,
      });
      note({
        channel: "sms",
        to: input.customerPhone,
        ok: result.ok,
        detail: result.ok ? result.status : `${result.errorCode}: ${result.errorDetail}`,
      });
    }
  }

  if (wants.has("email")) {
    if (!looksLikeEmail(input.customerEmail)) {
      note({
        channel: "email",
        to: input.customerEmail,
        ok: false,
        detail: input.customerEmail
          ? "That address is not one mail can be sent to."
          : "No email address on this customer.",
      });
    } else {
      const mail = invoiceEmail(input.facts);
      const sent = await sendEmail({
        to: input.customerEmail,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        from: emailSender(input.facts.businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
      });
      note({
        channel: "email",
        to: input.customerEmail,
        ok: sent.ok,
        detail: sent.ok ? sent.id : `${sent.errorCode}: ${sent.errorDetail}`,
      });
    }
  }

  // Appended, never replaced. An invoice is often chased more than once, and
  // the earlier attempts are the record of how hard the business tried.
  try {
    const { data: existing } = await database
      .from("invoices")
      .select("deliveries")
      .eq("id", input.invoiceId)
      .maybeSingle();

    const previous = Array.isArray(existing?.deliveries)
      ? (existing.deliveries as unknown[])
      : [];

    const succeeded = attempts.some((attempt) => attempt.ok);
    await database
      .from("invoices")
      .update({
        deliveries: [...previous, ...attempts],
        ...(succeeded ? { last_sent_at: new Date().toISOString() } : {}),
      })
      .eq("id", input.invoiceId);
  } catch {
    // The message may already be gone. Do not report a send failure merely
    // because the delivery audit trail could not be appended.
  }

  return attempts;
}

export { describeDelivery } from "@/lib/invoice-messages";
