import "server-only";

import { recordActivity } from "@/lib/activity";
import { readLegalNotices, withinCancellationPeriod } from "@/lib/ca-home-improvement";
import { cancellationRefundSteps, type PaidOnJob } from "@/lib/cancellation-refunds";
import { sendEmail } from "@/lib/email";
import { refundStatusFromStripe } from "@/lib/invoice-refund";
import { refundInvoicePayment } from "@/lib/invoice-refund-server";
import { getStripe } from "@/lib/stripe";
import { paymentAccountFor } from "@/lib/stripe-connect";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Telling the business a customer cancelled a home improvement contract
 * (compliance CSLB-007-007, CA-005-007/008). The cancellation is already
 * recorded; this puts it on the job's history and in front of the owner, with
 * the date everything paid must be refunded by. A failure here never undoes
 * the cancellation: the job page shows it either way.
 *
 * Only the business's own alert email and number are used, read fresh here,
 * so this cannot be used to reach anybody else.
 */
export async function notifyContractCancelled(input: { organizationId: string; contractId: string }): Promise<void> {
  const database = asFlexibleClient(getSupabaseAdmin());
  const { data } = await database
    .from("contracts")
    .select("job_id, cancelled_at, cancellation_channel, cancellation_note, refund_due_by, jobs ( job_number ), organizations ( name, timezone, owner_notification_email, owner_notification_phone )")
    .eq("organization_id", input.organizationId)
    .eq("id", input.contractId)
    .maybeSingle();
  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row?.cancelled_at) return;

  const job = (row.jobs ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const day = (iso: string) =>
    iso ? new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)) : "";
  const jobNumber = String(job?.job_number ?? "");
  const refundBy = day(text(row.refund_due_by));
  const note = text(row.cancellation_note);
  const byLink = row.cancellation_channel === "customer_link";

  await recordActivity(database, {
    organizationId: input.organizationId,
    eventType: "contract.cancelled",
    label: `Contract cancelled by the customer${byLink ? " from their link" : ""}. Refund everything paid by ${refundBy}.`,
    jobId: text(row.job_id) || null,
    metadata: { contract_id: input.contractId, channel: text(row.cancellation_channel), refund_due_by: text(row.refund_due_by), ...(note ? { note } : {}) },
  }).catch((error: unknown) => console.error("contract cancellation not recorded in history", error));

  const ownerEmail = text(organization?.owner_notification_email);
  if (!ownerEmail) return;
  const appUrl = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const link = appUrl && jobNumber ? `${appUrl}/jobs/${jobNumber}` : "";
  const lines = [
    `The customer on job #${jobNumber} cancelled their contract${byLink ? " from their contract link" : ""} on ${day(text(row.cancelled_at))}.`,
    note ? `They wrote: "${note}"` : "",
    `California law requires returning everything they paid within 10 days of the cancellation: by ${refundBy}.`,
    "Don't start or continue the work. Open the job to refund their payments.",
    link,
  ].filter(Boolean);
  const result = await sendEmail({
    to: ownerEmail,
    subject: `Contract cancelled: job #${jobNumber}. Refund by ${refundBy}`,
    text: lines.join("\n\n"),
    html: lines.map((line) => `<p>${line.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</p>`).join(""),
    organizationId: input.organizationId,
    idempotencyKey: `contract-cancelled:${input.contractId}`,
  });
  if (!result.ok) console.error("contract cancellation email not sent", { contractId: input.contractId, error: result.errorCode });
}

/**
 * Why nothing may be asked for or taken on a job right now because of its
 * home improvement contract's right to cancel, or null. The database refuses
 * the same (private.job_cancellation_hold); this says it before trying, and
 * keeps the deposit request waiting, unclaimed, until the period ends, when
 * the worker sends it.
 */
export async function jobCancellationHold(
  database: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
): Promise<string | null> {
  const { data, error } = await database
    .from("contracts")
    .select("status, signed_at, legal_notices, cancel_deadline, cancelled_at")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .eq("kind", "agreement")
    .in("status", ["signed", "cancelled"])
    .order("signed_at", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  // Unreadable: the database guard still refuses, so carry on rather than block everything.
  if (error || !data) return null;
  const row = data as Record<string, unknown>;
  if (row.status === "cancelled") return "The customer cancelled this contract. Nothing more can be collected; refund what they paid.";
  const notices = readLegalNotices(row.legal_notices);
  const held = withinCancellationPeriod(
    {
      cancellable: Boolean(notices?.cancellationForm),
      signedAt: typeof row.signed_at === "string" ? row.signed_at : null,
      cancelDeadline: typeof row.cancel_deadline === "string" ? row.cancel_deadline : null,
      cancelledAt: typeof row.cancelled_at === "string" ? row.cancelled_at : null,
    },
    new Date(),
  );
  return held ? "The customer can still cancel this contract. Payments wait until their right to cancel ends." : null;
}

export type CancellationRefundResult = { ok: boolean; message: string };

/**
 * "Refund all payments" after a customer cancelled: every payment on the job
 * with money still unreturned is refunded in full, through Stripe when Stripe
 * took it (invoice payments through the invoice refund ledger, deposits
 * through job_prepayment_refunds), otherwise recorded as handed back. Pressing
 * it again only finishes what is left. `db` is the signed-in person's own
 * client (the invoice refund function checks their permission there); the
 * caller has already checked they may edit billing.
 */
export async function refundCancelledContract(
  db: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; userId: string },
): Promise<CancellationRefundResult> {
  const admin = asFlexibleClient(getSupabaseAdmin());
  const { data: contract } = await admin
    .from("contracts")
    .select("id, status")
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId)
    .eq("kind", "agreement")
    .eq("status", "cancelled")
    .order("cancelled_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!contract) return { ok: false, message: "This job has no cancelled contract, so nothing is refunded here." };

  const [invoicePayments, invoiceRefunds, prepayments, prepaymentRefunds] = await Promise.all([
    admin.from("invoice_payments").select("id, method, amount_cents, stripe_checkout_session_id").eq("organization_id", input.organizationId).eq("job_id", input.jobId),
    admin.from("invoice_refunds").select("invoice_payment_id, amount_cents, status").eq("organization_id", input.organizationId).eq("job_id", input.jobId),
    admin
      .from("job_prepayments")
      .select("id, method, amount_cents, stripe_checkout_session_id")
      .eq("organization_id", input.organizationId)
      .eq("job_id", input.jobId)
      .is("applied_invoice_payment_id", null),
    admin.from("job_prepayment_refunds").select("prepayment_id, amount_cents, status").eq("organization_id", input.organizationId).eq("job_id", input.jobId),
  ]);
  if (invoicePayments.error || invoiceRefunds.error || prepayments.error || prepaymentRefunds.error) {
    return { ok: false, message: "The job's payments could not be read, so nothing was refunded. Try again." };
  }

  const rows = (value: unknown) => (Array.isArray(value) ? (value as Record<string, unknown>[]) : []);
  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const num = (value: unknown) => (typeof value === "number" ? value : Number(value ?? 0)) || 0;
  const returned = (refunds: Record<string, unknown>[], key: string, id: string) =>
    refunds.filter((refund) => str(refund[key]) === id && (refund.status === "succeeded" || refund.status === "pending")).reduce((sum, refund) => sum + num(refund.amount_cents), 0);

  const paid: PaidOnJob[] = [
    ...rows(invoicePayments.data).map((payment) => ({
      id: str(payment.id),
      source: "invoice" as const,
      method: str(payment.method),
      amountCents: num(payment.amount_cents),
      refundedCents: returned(rows(invoiceRefunds.data), "invoice_payment_id", str(payment.id)),
      viaStripe: Boolean(str(payment.stripe_checkout_session_id)),
    })),
    ...rows(prepayments.data).map((payment) => ({
      id: str(payment.id),
      source: "prepayment" as const,
      method: str(payment.method),
      amountCents: num(payment.amount_cents),
      refundedCents: returned(rows(prepaymentRefunds.data), "prepayment_id", str(payment.id)),
      viaStripe: (payment.method === "card" || payment.method === "ach") && Boolean(str(payment.stripe_checkout_session_id)),
    })),
  ];
  const sessions = new Map(rows(prepayments.data).map((payment) => [str(payment.id), str(payment.stripe_checkout_session_id)]));

  const steps = cancellationRefundSteps(paid);
  const failures: string[] = [];
  let returnedCents = 0;
  for (const step of steps) {
    if (step.source === "invoice") {
      const outcome = await refundInvoicePayment(db, {
        paymentId: step.id,
        amountCents: step.amountCents,
        reason: "The customer cancelled the contract.",
        jobId: input.jobId,
      });
      if (outcome.ok) returnedCents += step.amountCents;
      else failures.push(outcome.message);
      continue;
    }

    // A deposit: recorded first, so a retry never refunds it twice.
    const { error: claimError } = await admin.from("job_prepayment_refunds").upsert(
      {
        organization_id: input.organizationId,
        job_id: input.jobId,
        prepayment_id: step.id,
        amount_cents: step.amountCents,
        how: step.how,
        status: step.how === "by_hand" ? "succeeded" : "pending",
        failure_reason: null,
        refunded_by: input.userId || null,
      },
      { onConflict: "prepayment_id" },
    );
    if (claimError) {
      failures.push("A deposit refund could not be recorded.");
      continue;
    }
    if (step.how === "by_hand") {
      returnedCents += step.amountCents;
      continue;
    }

    const settle = (fields: Record<string, unknown>) =>
      admin.from("job_prepayment_refunds").update(fields).eq("organization_id", input.organizationId).eq("prepayment_id", step.id);
    const stripe = getStripe();
    const account = await paymentAccountFor(input.organizationId);
    if (!stripe || !account) {
      await settle({ status: "failed", failure_reason: "Online payments are not connected." });
      failures.push("A card deposit could not be refunded: Stripe is not connected.");
      continue;
    }
    try {
      const session = await stripe.checkout.sessions.retrieve(sessions.get(step.id) ?? "", {}, { stripeAccount: account.accountId });
      const intent = typeof session.payment_intent === "string" ? session.payment_intent : session.payment_intent?.id ?? "";
      if (!intent) throw new Error("Stripe has no payment for this deposit.");
      const refund = await stripe.refunds.create(
        {
          payment_intent: intent,
          amount: step.amountCents,
          reason: "requested_by_customer",
          refund_application_fee: true,
          metadata: { volteira_prepayment_refund: step.id },
        },
        { stripeAccount: account.accountId, idempotencyKey: `volteira-prepayment-refund-${step.id}-${step.amountCents}` },
      );
      const status = refundStatusFromStripe(refund.status);
      const failed = status === "failed" || status === "canceled";
      await settle({ status: failed ? "failed" : status, stripe_refund_id: refund.id, failure_reason: refund.failure_reason ?? null });
      if (failed) failures.push("Stripe did not refund a card deposit.");
      else returnedCents += step.amountCents;
    } catch (stripeError) {
      const reason = stripeError instanceof Error ? stripeError.message.slice(0, 300) : "Stripe refused the refund.";
      await settle({ status: "failed", failure_reason: reason });
      failures.push(`Stripe did not refund a card deposit: ${reason}`);
    }
  }

  const amount = (cents: number) => (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  const byHand = steps.filter((step) => step.how === "by_hand").reduce((sum, step) => sum + step.amountCents, 0);
  if (failures.length === 0) {
    await admin
      .from("contracts")
      .update({ refunds_completed_at: new Date().toISOString() })
      .eq("organization_id", input.organizationId)
      .eq("id", str(contract.id))
      .is("refunds_completed_at", null);
  }
  await recordActivity(db, {
    organizationId: input.organizationId,
    eventType: "contract.cancellation_refunded",
    label: `Refunded ${amount(returnedCents)} after the customer cancelled${failures.length ? ` (${failures.length} not refunded)` : ""}`,
    jobId: input.jobId,
    metadata: { contract_id: str(contract.id), refunded_cents: returnedCents, by_hand_cents: byHand, failures: failures.length },
  }).catch(() => undefined);

  if (steps.length === 0) return { ok: true, message: "Everything the customer paid has already been returned." };
  const handNote = byHand > 0 ? ` ${amount(byHand)} paid in cash or check is marked returned: hand it back to the customer.` : "";
  return failures.length === 0
    ? { ok: true, message: `Refunded ${amount(returnedCents)}.${handNote}` }
    : { ok: false, message: `Refunded ${amount(returnedCents)}, but not everything: ${failures.join(" ")} Try again, or refund it from Stripe.` };
}
