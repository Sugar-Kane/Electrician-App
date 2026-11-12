import "server-only";

import type Stripe from "stripe";

import { recordActivity } from "@/lib/activity";
import { refundStatusFromStripe, type RefundStatus } from "@/lib/invoice-refund";
import { sendRefundNotice, skipRefundNotice } from "@/lib/refund-notice";
import { getStripe } from "@/lib/stripe";
import { paymentAccountFor } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Refunds: reading an invoice's payments with what has been refunded from
 * each, giving a refund, and taking in the refunds Stripe reports.
 *
 * Giving one starts in the database as the signed-in person
 * (`begin_invoice_refund` checks they are the owner or an admin and that the
 * payment still holds the amount). A card payment taken online is then sent
 * to Stripe on the business's own account, with Volteira's application fee
 * handed back too, and Stripe's answer is written by the server
 * (`settle_invoice_refund`). A refund made in Stripe's own dashboard arrives
 * by webhook (`record_stripe_refund`).
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type PaymentWithRefunds = {
  id: string;
  method: string;
  amountCents: number;
  recordedAt: string;
  note: string;
  /** Paid online by card or bank, so a refund goes back through Stripe. */
  online: boolean;
  refunds: { id: string; amountCents: number; status: RefundStatus; reason: string; createdAt: string; failure: string }[];
};

/** An invoice's payments, oldest first, each with its refunds. */
export async function getInvoicePayments(db: FlexibleSupabaseClient, invoiceId: string): Promise<PaymentWithRefunds[]> {
  const [{ data: payments }, { data: refunds }] = await Promise.all([
    db
      .from("invoice_payments")
      .select("id, method, amount_cents, recorded_at, note, stripe_checkout_session_id")
      .eq("invoice_id", invoiceId)
      .order("recorded_at", { ascending: true }),
    db
      .from("invoice_refunds")
      .select("id, invoice_payment_id, amount_cents, status, reason, created_at, failure_reason")
      .eq("invoice_id", invoiceId)
      .order("created_at", { ascending: true }),
  ]);
  const refundRows = ((refunds ?? []) as Row[]).map((row) => ({
    paymentId: text(row.invoice_payment_id),
    id: text(row.id),
    amountCents: Number(row.amount_cents ?? 0),
    status: refundStatusFromStripe(text(row.status)),
    reason: text(row.reason),
    createdAt: text(row.created_at),
    failure: text(row.failure_reason),
  }));
  return ((payments ?? []) as Row[]).map((row) => ({
    id: text(row.id),
    method: text(row.method),
    amountCents: Number(row.amount_cents ?? 0),
    recordedAt: text(row.recorded_at),
    note: text(row.note),
    online: Boolean(text(row.stripe_checkout_session_id)),
    refunds: refundRows.filter((refund) => refund.paymentId === text(row.id)),
  }));
}

export type RefundOutcome = { ok: true; status: RefundStatus; message: string } | { ok: false; message: string };

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Give a refund against one payment. `db` is the signed-in person's own
 * client, so the database decides whether they may.
 */
export async function refundInvoicePayment(
  db: FlexibleSupabaseClient,
  input: { paymentId: string; amountCents: number; reason: string; jobId?: string | null; notifyCustomer?: boolean },
): Promise<RefundOutcome> {
  const { data, error } = await db.rpc("begin_invoice_refund", {
    p_payment_id: input.paymentId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason || null,
  });
  if (error) {
    console.error("begin invoice refund failed", { code: error.code, message: error.message });
    if (error.code === "22023" || error.code === "42501") return { ok: false, message: `Not refunded: ${error.message}.` };
    if (error.code === "P0002") return { ok: false, message: "That payment could not be found." };
    return { ok: false, message: "The refund could not be started. Try again." };
  }
  const started = (Array.isArray(data) ? data[0] : data) as Row | null;
  const refundId = text(started?.refund_id);
  const organizationId = text(started?.organization_id);
  const intent = text(started?.payment_intent_id);
  if (!refundId) return { ok: false, message: "The refund could not be started. Try again." };
  // Decided before Stripe is asked, so its webhook cannot announce a refund
  // the customer was not to be told about.
  const notify = input.notifyCustomer !== false;
  if (!notify) await skipRefundNotice(refundId);

  const amount = dollars(input.amountCents);
  let status: RefundStatus = text(started?.status) === "succeeded" ? "succeeded" : "pending";
  let message = `${amount} recorded as refunded.`;

  if (status === "pending" && intent) {
    const admin = asFlexibleClient(getSupabaseAdmin());
    const stripe = getStripe();
    const account = await paymentAccountFor(organizationId);
    if (!stripe || !account) {
      await admin.rpc("settle_invoice_refund", {
        p_refund_id: refundId,
        p_status: "failed",
        p_failure_reason: "Online payments are not connected.",
      });
      return { ok: false, message: "Not refunded: this business's Stripe account is not connected." };
    }
    try {
      const refund = await stripe.refunds.create(
        {
          payment_intent: intent,
          amount: input.amountCents,
          reason: "requested_by_customer",
          // Volteira's share goes back with the customer's money.
          refund_application_fee: true,
          metadata: { volteira_refund_id: refundId },
        },
        { stripeAccount: account.accountId, idempotencyKey: `volteira-refund-${refundId}` },
      );
      status = refundStatusFromStripe(refund.status);
      await admin.rpc("settle_invoice_refund", {
        p_refund_id: refundId,
        p_status: status,
        p_stripe_refund_id: refund.id,
        p_failure_reason: refund.failure_reason ?? null,
      });
    } catch (stripeError) {
      const reason = stripeError instanceof Error ? stripeError.message.slice(0, 300) : "Stripe refused the refund.";
      console.error("stripe refund failed", { refundId, reason });
      await admin.rpc("settle_invoice_refund", { p_refund_id: refundId, p_status: "failed", p_failure_reason: reason });
      return { ok: false, message: `Stripe did not refund it: ${reason}` };
    }
    message =
      status === "succeeded"
        ? `${amount} refunded to the customer's card. It usually reaches them in 5–10 business days.`
        : status === "pending"
          ? `${amount} refund sent to Stripe. It shows as done once Stripe confirms.`
          : `Stripe did not refund it.`;
    if (status === "failed" || status === "canceled") return { ok: false, message };
  }

  if (notify) {
    const told = await sendRefundNotice(refundId);
    const by = [told.email === "sent" ? "email" : "", told.sms === "sent" ? "text" : ""].filter(Boolean);
    message += by.length > 0 ? ` The customer was told by ${by.join(" and ")}.` : " The customer could not be told (no email on file, and no texting consent).";
  }

  await recordActivity(db, {
    organizationId,
    eventType: "invoice.refunded",
    label: `Refund of ${amount}`,
    jobId: input.jobId ?? null,
    metadata: { amount_cents: input.amountCents, refund_id: refundId, invoice_id: text(started?.invoice_id) },
  });
  return { ok: true, status, message };
}

/** A refund Stripe reports on a business's account (refund.* and charge.refunded events). */
export async function handleRefundEvent(event: Stripe.Event, stripeAccount: string | undefined): Promise<boolean> {
  if (!stripeAccount) return false;
  const admin = asFlexibleClient(getSupabaseAdmin());

  const record = async (refund: Stripe.Refund) => {
    const intent = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id ?? "";
    if (!intent) return;
    const { error } = await admin.rpc("record_stripe_refund", {
      p_stripe_account_id: stripeAccount,
      p_payment_intent_id: intent,
      p_stripe_refund_id: refund.id,
      p_amount_cents: refund.amount,
      p_status: refundStatusFromStripe(refund.status),
      p_failure_reason: refund.failure_reason ?? null,
    });
    if (error) throw new Error(error.message);
    // A refund made in Stripe's dashboard is announced here; one given in
    // Volteira was already announced (or skipped), and the claim stops a repeat.
    const { data: row } = await admin.from("invoice_refunds").select("id").eq("stripe_refund_id", refund.id).maybeSingle();
    if (row?.id) await sendRefundNotice(String(row.id));
  };

  if (event.type === "refund.created" || event.type === "refund.updated" || event.type === "refund.failed") {
    await record(event.data.object as Stripe.Refund);
    return true;
  }
  if (event.type === "charge.refunded" || event.type === "charge.refund.updated") {
    const object = event.data.object as Stripe.Charge | Stripe.Refund;
    if (object.object === "refund") {
      await record(object as Stripe.Refund);
      return true;
    }
    const charge = object as Stripe.Charge;
    const intent = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? "";
    const stripe = getStripe();
    if (!intent || !stripe) return true;
    const refunds = await stripe.refunds.list({ payment_intent: intent, limit: 100 }, { stripeAccount });
    for (const refund of refunds.data) await record(refund);
    return true;
  }
  return false;
}
