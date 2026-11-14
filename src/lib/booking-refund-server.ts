import "server-only";

import { creditGivenCents } from "@/lib/follow-up-jobs";
import { refundStatusFromStripe, type RefundStatus } from "@/lib/invoice-refund";
import { getStripe } from "@/lib/stripe";
import { paymentAccountFor } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Refunds of a diagnostic fee the customer paid online when they booked.
 *
 * The fee is a row in `payments`, not an invoice payment, so it has its own
 * refunds (`booking_payment_refunds`). Giving one mirrors invoice refunds
 * (invoice-refund-server.ts): `begin_booking_refund` runs as the signed-in
 * person and checks they are the owner or an admin and that the fee still
 * holds the amount; the refund then goes to Stripe on the business's own
 * account, with Volteira's application fee handed back too, and Stripe's
 * answer is written by the server (`settle_booking_refund`). A refund made in
 * Stripe's own dashboard arrives by webhook (`record_stripe_refund`).
 *
 * Once a refund goes through, the job's diagnostic credit shrinks to what the
 * customer still has paid, so the repair invoice never takes off money that
 * was already given back, and the job's activity notes the refund (both in
 * the database, so a dashboard refund gets them too).
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type DiagnosticFeePayment = {
  id: string;
  amountCents: number;
  paidAt: string;
  /**
   * Of the fee, what has already come off an invoice (not void) on this job or
   * one booked from it. That part was given back as a credit and cannot also
   * be refunded (begin_booking_refund refuses it).
   */
  creditUsedCents: number;
  refunds: {
    id: string;
    amountCents: number;
    status: RefundStatus;
    reason: string;
    createdAt: string;
    failure: string;
  }[];
};

/** The diagnostic fee paid online for this job, with its refunds, or null. */
export async function getJobDiagnosticPayment(
  db: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
): Promise<DiagnosticFeePayment | null> {
  const { data: payment } = await db
    .from("payments")
    .select("id, amount_cents, paid_at")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("status", "succeeded")
    .not("booking_request_id", "is", null)
    .order("paid_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const row = payment as Row | null;
  if (!row?.id) return null;

  const [{ data: refunds, error }, { data: followUps }] = await Promise.all([
    db
      .from("booking_payment_refunds")
      .select("id, amount_cents, status, reason, created_at, failure_reason")
      .eq("payment_id", text(row.id))
      .order("created_at", { ascending: true }),
    db.from("jobs").select("id").eq("organization_id", organizationId).eq("follow_up_of", jobId),
  ]);
  const jobIds = [jobId, ...((followUps ?? []) as Row[]).map((job) => text(job.id)).filter(Boolean)];
  const { data: invoices } = await db
    .from("invoices")
    .select("status, diagnostic_credit_cents")
    .eq("organization_id", organizationId)
    .in("job_id", jobIds);

  return {
    id: text(row.id),
    amountCents: Number(row.amount_cents ?? 0),
    paidAt: text(row.paid_at),
    creditUsedCents: creditGivenCents(
      ((invoices ?? []) as Row[]).map((invoice) => ({
        status: text(invoice.status),
        diagnosticCreditCents: Number(invoice.diagnostic_credit_cents ?? 0),
      })),
    ),
    // A database without the refunds table yet simply has none.
    refunds: (error ? [] : ((refunds ?? []) as Row[])).map((refund) => ({
      id: text(refund.id),
      amountCents: Number(refund.amount_cents ?? 0),
      status: refundStatusFromStripe(text(refund.status)),
      reason: text(refund.reason),
      createdAt: text(refund.created_at),
      failure: text(refund.failure_reason),
    })),
  };
}

export type BookingRefundOutcome = { ok: true; status: RefundStatus; message: string } | { ok: false; message: string };

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * Refund some or all of a diagnostic fee to the customer's card. `db` is the
 * signed-in person's own client, so the database decides whether they may.
 */
export async function refundDiagnosticFee(
  db: FlexibleSupabaseClient,
  input: { paymentId: string; amountCents: number; reason: string },
): Promise<BookingRefundOutcome> {
  const { data, error } = await db.rpc("begin_booking_refund", {
    p_payment_id: input.paymentId,
    p_amount_cents: input.amountCents,
    p_reason: input.reason || null,
  });
  if (error) {
    console.error("begin booking refund failed", { code: error.code, message: error.message });
    if (error.code === "22023" || error.code === "42501") return { ok: false, message: `Not refunded: ${error.message}.` };
    if (error.code === "P0002") return { ok: false, message: "That payment could not be found." };
    return { ok: false, message: "The refund could not be started. Try again." };
  }
  const started = (Array.isArray(data) ? data[0] : data) as Row | null;
  const refundId = text(started?.refund_id);
  const organizationId = text(started?.organization_id);
  const intent = text(started?.payment_intent_id);
  if (!refundId || !intent) return { ok: false, message: "The refund could not be started. Try again." };

  const admin = asFlexibleClient(getSupabaseAdmin());
  const stripe = getStripe();
  const account = await paymentAccountFor(organizationId);
  if (!stripe || !account) {
    await admin.rpc("settle_booking_refund", {
      p_refund_id: refundId,
      p_status: "failed",
      p_failure_reason: "Online payments are not connected.",
    });
    return { ok: false, message: "Not refunded: this business's Stripe account is not connected." };
  }

  const amount = dollars(input.amountCents);
  let status: RefundStatus;
  try {
    const refund = await stripe.refunds.create(
      {
        payment_intent: intent,
        amount: input.amountCents,
        reason: "requested_by_customer",
        // Volteira's share goes back with the customer's money.
        refund_application_fee: true,
        metadata: { volteira_booking_refund_id: refundId },
      },
      { stripeAccount: account.accountId, idempotencyKey: `volteira-booking-refund-${refundId}` },
    );
    status = refundStatusFromStripe(refund.status);
    await admin.rpc("settle_booking_refund", {
      p_refund_id: refundId,
      p_status: status,
      p_stripe_refund_id: refund.id,
      p_failure_reason: refund.failure_reason ?? null,
    });
  } catch (stripeError) {
    const reason = stripeError instanceof Error ? stripeError.message.slice(0, 300) : "Stripe refused the refund.";
    console.error("stripe booking refund failed", { refundId, reason });
    await admin.rpc("settle_booking_refund", { p_refund_id: refundId, p_status: "failed", p_failure_reason: reason });
    return { ok: false, message: `Stripe did not refund it: ${reason}` };
  }

  if (status === "failed" || status === "canceled") return { ok: false, message: "Stripe did not refund it." };

  return {
    ok: true,
    status,
    message:
      status === "succeeded"
        ? `${amount} refunded to the customer's card. It usually reaches them in 5–10 business days.`
        : `${amount} refund sent to Stripe. It shows as done once Stripe confirms.`,
  };
}
