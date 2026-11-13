import "server-only";

import { emailSender, looksLikeEmail } from "@/lib/booking-confirmation";
import { recordText } from "@/lib/contract-copy";
import { sendEmail } from "@/lib/email";
import { invoiceLabel } from "@/lib/invoice-label";
import { refundStatusFromStripe, refundSummary } from "@/lib/invoice-refund";
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

const REFUND_COLUMNS =
  "organization_id, invoice_id, amount_cents, method, invoice_payment_id, invoices ( invoice_number, number_label, total_cents ), jobs ( job_number, customer_id, customers ( first_name, email, phone ) ), organizations ( name, phone )";

/**
 * The refund notice, sent again on request as a receipt: the same notice with
 * what was paid, what was refunded and what was kept on the invoice. Not
 * claimed, so it can be sent as often as asked; the caller has already
 * checked the refund is theirs.
 */
export async function sendRefundReceipt(refundId: string, reference = ""): Promise<{ email: string; sms: string }> {
  return sendRefundNotice(refundId, { receipt: true, reference });
}

export async function sendRefundNotice(
  refundId: string,
  /** `reference`: the card network's number for the refund (from Stripe), for the customer to trace it. */
  options: { receipt?: boolean; reference?: string } = {},
): Promise<{ email: string; sms: string }> {
  const outcome = { email: "not sent", sms: "not sent" };
  const receipt = options.receipt === true;
  const reference = (options.reference ?? "").trim();
  try {
    const database = getSupabaseAdmin();
    // Claim it: only the first caller for a refund that is done or on its way.
    // A receipt asked for by hand is not claimed; it goes every time.
    const { data: claimed } = receipt
      ? await database
          .from("invoice_refunds")
          .select(REFUND_COLUMNS)
          .eq("id", refundId)
          .in("status", ["succeeded", "pending"])
          .maybeSingle()
      : await database
          .from("invoice_refunds")
          .update({ customer_notice: "sending" })
          .eq("id", refundId)
          .is("customer_notice", null)
          .in("status", ["succeeded", "pending"])
          .select(REFUND_COLUMNS)
          .maybeSingle();
    if (!claimed) {
      return receipt
        ? { email: "this refund was not done", sms: "this refund was not done" }
        : { email: "already told or not due", sms: "already told or not due" };
    }

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

    // The receipt: what was paid on the invoice, refunded from it, and kept.
    let totals: { paid: number; refunded: number } | null = null;
    if (receipt && text(row.invoice_id)) {
      const [{ data: payments }, { data: refunds }] = await Promise.all([
        database.from("invoice_payments").select("amount_cents").eq("invoice_id", text(row.invoice_id)),
        database.from("invoice_refunds").select("amount_cents, status").eq("invoice_id", text(row.invoice_id)),
      ]);
      // The same sums the invoice page shows (refundSummary), so the two never disagree.
      const summary = refundSummary(
        ((payments ?? []) as Row[]).map((each) => ({ amountCents: Number(each.amount_cents ?? 0) })),
        ((refunds ?? []) as Row[]).map((each) => ({ amountCents: Number(each.amount_cents ?? 0), status: refundStatusFromStripe(text(each.status)) })),
      );
      totals = { paid: summary.paidCents, refunded: summary.refundedCents + summary.pendingCents };
    }

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
        ...(totals
          ? ["", `Paid: ${dollars(totals.paid)}`, `Refunded: -${dollars(totals.refunded)}`, `Kept: ${dollars(Math.max(totals.paid - totals.refunded, 0))}`]
          : []),
        ...(reference ? [`Card refund reference: ${reference}`] : []),
        businessPhone ? `Questions? Call us at ${businessPhone}.` : "",
        "",
        businessName,
      ].filter((line, index, all) => line !== "" || (index > 0 && all[index - 1] !== ""));
      const sent = await sendEmail({
        to: email,
        subject: receipt ? `Refund receipt: ${amount} from ${businessName}` : `Your refund of ${amount} from ${businessName}`,
        text: lines.join("\n"),
        html: [
          `<p>${escapeHtml(firstName ? `Hi ${firstName},` : "Hello,")}</p>`,
          `<p style="font-size:14px;color:#475569;margin:0">Refund</p>`,
          `<p style="font-size:28px;margin:0 0 12px"><strong>${escapeHtml(amount)}</strong></p>`,
          `<p>${escapeHtml(`${businessName} has refunded ${amount}${forWhat}.`)}</p>`,
          `<p>${escapeHtml(when)}</p>`,
          totals
            ? `<table role="presentation" style="border-collapse:collapse;margin:8px 0 16px;width:100%;max-width:360px">${[
                ["Invoice", label ? `INV-${label}` : ""],
                ["Paid", dollars(totals.paid)],
                ["Refunded", `−${dollars(totals.refunded)}`],
                ["Kept", dollars(Math.max(totals.paid - totals.refunded, 0))],
              ]
                .filter(([, value]) => value)
                .map(
                  ([name, value], index, all) =>
                    `<tr><td style="padding:6px 16px 6px 0;color:#475569;${index === all.length - 1 ? "border-top:1px solid #e2e8f0;" : ""}">${escapeHtml(name)}</td><td style="padding:6px 0;text-align:right;font-weight:600;${index === all.length - 1 ? "border-top:1px solid #e2e8f0;" : ""}">${escapeHtml(value)}</td></tr>`,
                )
                .join("")}</table>`
            : "",
          reference
            ? `<p style="font-size:14px;color:#475569">Card refund reference: <strong>${escapeHtml(reference)}</strong><br>Your card company can use this number to find the refund.</p>`
            : "",
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
        const smsBody = totals
          ? `${body} Paid ${dollars(totals.paid)}, refunded ${dollars(totals.refunded)}, kept ${dollars(Math.max(totals.paid - totals.refunded, 0))}.`
          : body;
        const result = await sendSms({ to: phone, body: smsBody, messagingServiceSid: sid });
        outcome.sms = result.ok ? "sent" : `${result.errorCode}: ${result.errorDetail}`;
        if (result.ok) {
          anySent = true;
          await recordText(database, organizationId, customerId, smsBody, result.providerMessageId);
        } else anyFailed = true;
      }
    } else {
      outcome.sms = phone ? "no customer record" : "no phone on file";
    }

    // A receipt sent by hand does not rewrite whether the first notice went.
    if (!receipt) {
      await database
        .from("invoice_refunds")
        .update({ customer_notice: anySent ? "sent" : anyFailed ? "failed" : "skipped" })
        .eq("id", refundId);
    }
  } catch (error) {
    console.error("refund notice failed", { refundId, error });
  }
  return outcome;
}
