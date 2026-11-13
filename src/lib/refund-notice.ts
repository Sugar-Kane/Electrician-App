import "server-only";

import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { recordText } from "@/lib/contract-copy";
import { sendEmail } from "@/lib/email";
import { invoiceLabel } from "@/lib/invoice-label";
import { consentIsActive } from "@/lib/messaging-rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

/**
 * Telling the customer about a refund.
 *
 * By email when there is an address on file, and by text when the customer
 * has active texting consent (the same ledger every automatic text checks; a
 * STOP is final). Sent once per refund: the notice is claimed in the database
 * first, so a refund Stripe reports several times is announced once. Only for
 * a refund done or on its way, never a failed one. Best effort and never
 * throws: the refund has already happened.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function one(value: unknown): Row {
  return ((Array.isArray(value) ? value[0] : value) ?? {}) as Row;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/** The person giving the refund chose not to tell the customer. */
export async function skipRefundNotice(refundId: string): Promise<void> {
  await getSupabaseAdmin()
    .from("invoice_refunds")
    .update({ customer_notice: "skipped" })
    .eq("id", refundId)
    .is("customer_notice", null);
}

export async function sendRefundNotice(refundId: string): Promise<{ email: string; sms: string }> {
  const outcome = { email: "not sent", sms: "not sent" };
  try {
    const database = getSupabaseAdmin();
    // Claim it: only the first caller for a refund that is done or on its way.
    const { data: claimed } = await database
      .from("invoice_refunds")
      .update({ customer_notice: "sending" })
      .eq("id", refundId)
      .is("customer_notice", null)
      .in("status", ["succeeded", "pending"])
      .select("organization_id, amount_cents, method, invoice_payment_id, invoices ( invoice_number, number_label ), jobs ( job_number, customer_id, customers ( first_name, email, phone ) ), organizations ( name, phone )")
      .maybeSingle();
    if (!claimed) return { email: "already told or not due", sms: "already told or not due" };

    const row = claimed as Row;
    const organizationId = text(row.organization_id);
    const job = one(row.jobs);
    const customer = one(job.customers);
    const organization = one(row.organizations);
    const invoice = one(row.invoices);
    const businessName = text(organization.name) || "Your electrician";
    const businessPhone = text(organization.phone);
    const firstName = text(customer.first_name);
    const amount = dollars(Number(row.amount_cents ?? 0));
    const label = invoiceLabel(invoice);
    const forWhat = label ? ` for invoice INV-${label}` : job.job_number ? ` for job #${job.job_number}` : "";

    // Back to a card through Stripe, or handed back in person.
    let toCard = false;
    if (text(row.invoice_payment_id)) {
      const { data: payment } = await database
        .from("invoice_payments")
        .select("stripe_checkout_session_id")
        .eq("id", text(row.invoice_payment_id))
        .maybeSingle();
      toCard = Boolean(text(payment?.stripe_checkout_session_id));
    }
    const when = toCard
      ? "It is on its way back to the card you paid with and usually shows within 5 to 10 business days."
      : "This is your confirmation of the money we returned to you.";

    let anySent = false;
    let anyFailed = false;

    const email = text(customer.email).trim();
    if (looksLikeEmail(email)) {
      const lines = [
        firstName ? `Hi ${firstName},` : "Hello,",
        "",
        `${businessName} has refunded ${amount}${forWhat}.`,
        when,
        businessPhone ? `Questions? Call us at ${businessPhone}.` : "",
        "",
        businessName,
      ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
      const sent = await sendEmail({
        to: email,
        subject: `Your refund of ${amount} from ${businessName}`,
        text: lines.join("\n"),
        html: [
          `<p>${escapeHtml(firstName ? `Hi ${firstName},` : "Hello,")}</p>`,
          `<p style="font-size:14px;color:#475569;margin:0">Refund</p>`,
          `<p style="font-size:28px;margin:0 0 12px"><strong>${escapeHtml(amount)}</strong></p>`,
          `<p>${escapeHtml(`${businessName} has refunded ${amount}${forWhat}.`)}</p>`,
          `<p>${escapeHtml(when)}</p>`,
          businessPhone
            ? `<p>Questions? Call us at <a href="tel:${escapeHtml(businessPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(businessPhone)}</a>.</p>`
            : "",
          `<p style="color:#475569">${escapeHtml(businessName)}</p>`,
        ].join(""),
        from: emailSender(businessName, process.env.BOOKING_EMAIL_FROM ?? ""),
      });
      outcome.email = sent.ok ? "sent" : `${sent.errorCode}: ${sent.errorDetail}`;
      if (sent.ok) anySent = true;
      else anyFailed = true;
    } else {
      outcome.email = "no email on file";
    }

    const phone = text(customer.phone);
    const customerId = text(job.customer_id);
    if (phone && customerId) {
      const [{ data: consent }, { data: settings }] = await Promise.all([
        database
          .from("messaging_consent")
          .select("opted_in_at, opted_out_at")
          .eq("organization_id", organizationId)
          .eq("customer_id", customerId)
          .eq("channel", "sms")
          .eq("scope", "transactional")
          .maybeSingle(),
        database.from("messaging_settings").select("messaging_service_sid").eq("organization_id", organizationId).maybeSingle(),
      ]);
      const active = consentIsActive({
        optedInAt: consent?.opted_in_at ? String(consent.opted_in_at) : null,
        optedOutAt: consent?.opted_out_at ? String(consent.opted_out_at) : null,
      });
      const sid = text(settings?.messaging_service_sid);
      if (!active) outcome.sms = "no texting consent";
      else if (!sid) outcome.sms = "texting not set up";
      else {
        const body = toCard
          ? `${businessName}: we've refunded ${amount}${forWhat}. It usually reaches your card in 5-10 business days.`
          : `${businessName}: this confirms the ${amount} refund${forWhat}.`;
        const result = await sendSms({ to: phone, body, messagingServiceSid: sid });
        outcome.sms = result.ok ? "sent" : `${result.errorCode}: ${result.errorDetail}`;
        if (result.ok) {
          anySent = true;
          await recordText(database, organizationId, customerId, body, result.providerMessageId);
        } else anyFailed = true;
      }
    } else {
      outcome.sms = phone ? "no customer record" : "no phone on file";
    }

    await database
      .from("invoice_refunds")
      .update({ customer_notice: anySent ? "sent" : anyFailed ? "failed" : "skipped" })
      .eq("id", refundId);
  } catch (error) {
    console.error("refund notice failed", { refundId, error });
  }
  return outcome;
}
