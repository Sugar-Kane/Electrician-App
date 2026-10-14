import "server-only";

import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { sendEmail } from "@/lib/email";
import {
  invoiceEmail,
  invoicePreviewEmail,
  invoicePreviewSms,
  invoiceSms,
  invoiceViewUrl,
  repliedStop,
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
  /**
   * The bill, or a preview of it. A preview never makes the invoice sent: it
   * records only that the customer has seen what they will be billed.
   */
  kind?: "invoice" | "preview";
  /**
   * Whose invoice it is, when the caller already knows. Found from the
   * invoice otherwise: every send checks STOP, whoever started it.
   */
  customerId?: string;
}): Promise<DeliveryAttempt[]> {
  const preview = input.kind === "preview";
  const database = getSupabaseAdmin();

  // Read off the invoice itself, so the link and the STOP check do not depend
  // on every caller (the screen, the assistant, ChatGPT) remembering them.
  const { data: owner, error: ownerError } = await database
    .from("invoices")
    .select("preview_token, jobs ( customer_id )")
    .eq("id", input.invoiceId)
    .eq("organization_id", input.organizationId)
    .maybeSingle();
  const ownerRow = (owner ?? null) as Record<string, unknown> | null;
  const ownerJob = (Array.isArray(ownerRow?.jobs) ? ownerRow?.jobs[0] : ownerRow?.jobs) as { customer_id?: unknown } | null;
  const found =
    input.customerId || (typeof ownerJob?.customer_id === "string" ? ownerJob.customer_id : "")
      ? { id: input.customerId || String(ownerJob?.customer_id), unknown: false }
      : ownerError
        ? { id: "", unknown: true }
        : await customerByPhone(database, input.organizationId, input.customerPhone);
  const facts: InvoiceFacts = {
    ...input.facts,
    viewUrl:
      input.facts.viewUrl ??
      invoiceViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", typeof ownerRow?.preview_token === "string" ? ownerRow.preview_token : ""),
  };
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
    } else if (found.unknown) {
      note({
        channel: "sms",
        to: input.customerPhone,
        ok: false,
        detail: "Could not check whether this customer replied STOP, so no text was sent. Try again.",
      });
    } else if (found.id && (await optedOut(database, input.organizationId, found.id)) !== "clear") {
      note({
        channel: "sms",
        to: input.customerPhone,
        ok: false,
        detail: "This customer replied STOP, or it could not be checked, so no text was sent.",
      });
    } else {
      const result = await sendSms({
        to: input.customerPhone,
        body: preview ? invoicePreviewSms(facts) : invoiceSms(facts),
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
      const mail = preview ? invoicePreviewEmail(facts) : invoiceEmail(facts);
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
      .select("deliveries, status")
      .eq("id", input.invoiceId)
      .maybeSingle();

    const previous = Array.isArray(existing?.deliveries)
      ? (existing.deliveries as unknown[])
      : [];

    const succeeded = attempts.some((attempt) => attempt.ok);
    // A draft that reached the customer is sent. Recording only the time left
    // the status at draft, so the job said Draft about a bill the customer
    // had in hand. Any later status (part paid, paid) is left as it is.
    const nowSent = !preview && succeeded && existing?.status === "draft";
    const recorded = attempts.map((attempt) => (preview ? { ...attempt, kind: "preview" } : attempt));
    await database
      .from("invoices")
      .update({
        deliveries: [...previous, ...recorded],
        ...(succeeded && !preview ? { last_sent_at: new Date().toISOString() } : {}),
        ...(succeeded && preview ? { preview_sent_at: new Date().toISOString() } : {}),
        ...(nowSent ? { status: "sent" } : {}),
      })
      .eq("id", input.invoiceId);
  } catch {
    // The message may already be gone. Do not report a send failure merely
    // because the delivery audit trail could not be appended.
  }

  return attempts;
}

/**
 * Whether a customer's last word on texts was STOP. "unknown" when the record
 * could not be read, which the caller treats as STOP: a text is never sent on
 * a guess.
 */
async function optedOut(
  database: ReturnType<typeof getSupabaseAdmin>,
  organizationId: string,
  customerId: string,
): Promise<"stopped" | "clear" | "unknown"> {
  const { data, error } = await database
    .from("messaging_consent")
    .select("opted_in_at, opted_out_at")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("channel", "sms")
    .eq("scope", "transactional")
    .maybeSingle();
  if (error) return "unknown";
  return repliedStop(
    data ? { optedInAt: data.opted_in_at ? String(data.opted_in_at) : null, optedOutAt: data.opted_out_at ? String(data.opted_out_at) : null } : null,
  )
    ? "stopped"
    : "clear";
}

/** The business's customer with this number, for an invoice with no job to say whose it is. */
async function customerByPhone(
  database: ReturnType<typeof getSupabaseAdmin>,
  organizationId: string,
  phone: string,
): Promise<{ id: string; unknown: boolean }> {
  if (!phone) return { id: "", unknown: false };
  const { data, error } = await database
    .from("customers")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("phone", phone)
    .limit(1)
    .maybeSingle();
  if (error) return { id: "", unknown: true };
  return { id: typeof data?.id === "string" ? data.id : "", unknown: false };
}

export { describeDelivery } from "@/lib/invoice-messages";
