"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, RotateCcw } from "lucide-react";

import {
  refundDiagnosticFeeAction,
  type DiagnosticRefundState,
} from "@/app/jobs/[jobId]/diagnostic-refund-actions";
import { inputClass } from "@/components/ui/field";
import { refundableCents } from "@/lib/invoice-refund";
import { formatCents } from "@/lib/job-lines";
import type { DiagnosticFeePayment } from "@/lib/booking-refund-server";

/**
 * The diagnostic fee the customer paid online when they booked, what has been
 * refunded from it, and a Refund button while it still holds money (owner and
 * admin only). The refund goes back to their card through Stripe.
 */

const initial: DiagnosticRefundState = { error: "" };

const STATUS_LABELS: Record<string, string> = {
  succeeded: "Refunded",
  pending: "Refund on its way",
  failed: "Refund failed",
  canceled: "Refund canceled",
};

function day(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : at.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function RefundButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-critical/40 bg-critical-bg px-4 text-sm font-semibold text-critical disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
      {pending ? "Refunding…" : "Refund to card"}
    </button>
  );
}

export function DiagnosticFeeRefund({
  jobNumber,
  payment,
  canRefund,
}: {
  jobNumber: string;
  payment: DiagnosticFeePayment;
  /** The owner or an admin. */
  canRefund: boolean;
}) {
  const [state, action] = useActionState(refundDiagnosticFeeAction, initial);
  const refunded = payment.amountCents - refundableCents(payment.amountCents, payment.refunds);
  // What already came off an invoice was given back as a credit, so it cannot
  // be refunded to the card as well.
  const left = refundableCents(Math.max(0, payment.amountCents - payment.creditUsedCents), payment.refunds);

  return (
    <section aria-labelledby="diagnostic-fee-heading" className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="diagnostic-fee-heading" className="text-sm font-semibold">
          Diagnostic fee
        </h2>
        {refunded > 0 ? (
          <p className="text-sm text-ink-muted">
            {refunded >= payment.amountCents
              ? "Refunded in full"
              : `${formatCents(refunded)} refunded · ${formatCents(payment.amountCents - refunded)} kept`}
          </p>
        ) : null}
      </div>
      <div className="mt-2 flex items-baseline justify-between gap-3 text-sm">
        <span>
          <span className="font-semibold">Card</span>
          <span className="text-ink-muted"> · paid online at booking</span>
          <span className="block text-xs text-ink-muted">{day(payment.paidAt)}</span>
        </span>
        <span className="font-semibold">{formatCents(payment.amountCents)}</span>
      </div>
      {payment.refunds.length > 0 ? (
        <ul className="mt-1 space-y-0.5">
          {payment.refunds.map((refund) => (
            <li key={refund.id} className="flex items-baseline justify-between gap-3 text-xs">
              <span className={refund.status === "failed" || refund.status === "canceled" ? "text-critical" : "text-ink-muted"}>
                {STATUS_LABELS[refund.status]} · {day(refund.createdAt)}
                {refund.reason ? ` · ${refund.reason}` : ""}
                {refund.failure ? ` · ${refund.failure}` : ""}
              </span>
              <span className="text-ink-muted">−{formatCents(refund.amountCents)}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {payment.creditUsedCents > 0 ? (
        <p className="mt-2 text-xs leading-5 text-ink-muted">
          {formatCents(Math.min(payment.creditUsedCents, payment.amountCents))} of this fee has already come off an
          invoice as a credit, so it can&apos;t also be refunded here. To give it back, adjust that invoice.
        </p>
      ) : null}

      {canRefund && left > 0 ? (
        <details className="mt-2">
          <summary className="tap-target inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-brand">
            <RotateCcw className="h-4 w-4" aria-hidden />
            Refund
          </summary>
          <form action={action} className="mt-2 rounded-control border border-line p-3">
            <input type="hidden" name="jobNumber" value={jobNumber} />
            <input type="hidden" name="paymentId" value={payment.id} />
            <p className="text-xs leading-5 text-ink-muted">
              Goes back to the customer&apos;s card through Stripe, usually in 5–10 business days. Stripe keeps its
              processing fee. What is refunded no longer comes off the repair invoice.
            </p>
            <label className="mt-3 block text-xs font-semibold text-ink-muted" htmlFor={`diagnostic-refund-${payment.id}`}>
              Amount (blank refunds all {formatCents(left)})
            </label>
            <input
              id={`diagnostic-refund-${payment.id}`}
              name="amount"
              inputMode="decimal"
              placeholder={(left / 100).toFixed(2)}
              className={`${inputClass} mt-1`}
            />
            <input
              name="reason"
              placeholder="Reason, for your records (optional)"
              aria-label="Reason"
              maxLength={300}
              className={`${inputClass} mt-2`}
            />
            <RefundButton />
            {state.error ? (
              <p className="mt-2 text-sm text-critical" role="alert">
                {state.error}
              </p>
            ) : state.notice ? (
              <p className="mt-2 text-sm text-positive" role="status">
                {state.notice}
              </p>
            ) : null}
          </form>
        </details>
      ) : null}
    </section>
  );
}
