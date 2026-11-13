"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Receipt, RotateCcw } from "lucide-react";

import { refundPaymentAction, sendRefundReceiptAction, type InvoiceActionState } from "@/app/invoices/actions";
import { inputClass } from "@/components/ui/field";
import { refundableCents, refundSummary } from "@/lib/invoice-refund";
import { formatCents } from "@/lib/job-lines";
import type { PaymentWithRefunds } from "@/lib/invoice-refund-server";

/**
 * An invoice's payments, what has been refunded from each, and a Refund
 * button on each payment that still holds money (owner and admin only).
 *
 * A card payment taken online goes back to the customer's card through
 * Stripe; one taken in hand is recorded as handed back.
 */

const initial: InvoiceActionState = { error: "" };

const METHOD_LABELS: Record<string, string> = { cash: "Cash", check: "Check", card: "Card", bank: "Bank", other: "Other" };
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

function RefundButton({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-critical/40 bg-critical-bg px-4 text-sm font-semibold text-critical disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
      {pending ? "Refunding…" : label}
    </button>
  );
}

/** Send the customer the refund notice again, as a receipt with what was paid, refunded and kept. */
function RefundReceipt({ invoiceId, refundId }: { invoiceId: string; refundId: string }) {
  const [state, action] = useActionState(sendRefundReceiptAction, initial);
  return (
    <form action={action} className="mt-1">
      <input type="hidden" name="invoiceId" value={invoiceId} />
      <input type="hidden" name="refundId" value={refundId} />
      <ReceiptButton />
      {state.error ? (
        <p className="mt-1 text-xs text-critical" role="alert">
          {state.error}
        </p>
      ) : state.notice ? (
        <p className="mt-1 text-xs text-positive" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}

function ReceiptButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-10 items-center gap-1.5 text-sm font-semibold text-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Receipt className="h-4 w-4" aria-hidden />}
      {pending ? "Sending…" : "Send refund receipt"}
    </button>
  );
}

function RefundForm({ invoiceId, payment }: { invoiceId: string; payment: PaymentWithRefunds }) {
  const [state, action] = useActionState(refundPaymentAction, initial);
  const left = refundableCents(payment.amountCents, payment.refunds);
  return (
    <details className="mt-2">
      <summary className="tap-target inline-flex min-h-11 cursor-pointer items-center gap-1.5 text-sm font-semibold text-brand">
        <RotateCcw className="h-4 w-4" aria-hidden />
        Refund
      </summary>
      <form action={action} className="mt-2 rounded-control border border-line p-3">
        <input type="hidden" name="invoiceId" value={invoiceId} />
        <input type="hidden" name="paymentId" value={payment.id} />
        <p className="text-xs leading-5 text-ink-muted">
          {payment.online
            ? "Goes back to the customer's card through Stripe, usually in 5–10 business days. Stripe keeps its processing fee."
            : "Records that you handed the money back. Nothing is sent anywhere."}
        </p>
        <label className="mt-3 block text-xs font-semibold text-ink-muted" htmlFor={`refund-amount-${payment.id}`}>
          Amount (blank refunds all {formatCents(left)})
        </label>
        <input
          id={`refund-amount-${payment.id}`}
          name="amount"
          inputMode="decimal"
          placeholder={(left / 100).toFixed(2)}
          className={`${inputClass} mt-1`}
        />
        <input name="reason" placeholder="Reason, for your records (optional)" aria-label="Reason" maxLength={300} className={`${inputClass} mt-2`} />
        <label className="mt-3 flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="notifyCustomer" defaultChecked className="h-4 w-4" />
          Tell the customer (email, and text if they agreed to texts)
        </label>
        <RefundButton label={payment.online ? "Refund to card" : "Record refund"} />
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
  );
}

export function InvoicePayments({
  invoiceId,
  payments,
  canRefund,
}: {
  invoiceId: string;
  payments: PaymentWithRefunds[];
  /** The owner or an admin. */
  canRefund: boolean;
}) {
  if (payments.length === 0) return null;
  const summary = refundSummary(payments, payments.flatMap((payment) => payment.refunds));

  return (
    <section aria-labelledby="payments-heading" className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="payments-heading" className="text-sm font-semibold">
          Payments
        </h2>
        {summary.refundedCents + summary.pendingCents > 0 ? (
          <p className="text-sm text-ink-muted">
            {summary.refundedInFull
              ? "Refunded in full"
              : `${formatCents(summary.refundedCents + summary.pendingCents)} refunded · ${formatCents(summary.keptCents)} kept`}
          </p>
        ) : null}
      </div>
      <ul className="mt-2 divide-y divide-line">
        {payments.map((payment) => {
          const left = refundableCents(payment.amountCents, payment.refunds);
          return (
            <li key={payment.id} className="py-3">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span>
                  <span className="font-semibold">{METHOD_LABELS[payment.method] ?? "Payment"}</span>
                  {payment.online ? <span className="text-ink-muted"> · paid online</span> : null}
                  <span className="block text-xs text-ink-muted">
                    {day(payment.recordedAt)}
                    {payment.note ? ` · ${payment.note}` : ""}
                  </span>
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
                  {payment.refunds
                    .filter((refund) => refund.status === "succeeded")
                    .map((refund) => (
                    <li key={`receipt-${refund.id}`}>
                      <RefundReceipt invoiceId={invoiceId} refundId={refund.id} />
                    </li>
                  ))}
                </ul>
              ) : null}
              {canRefund && left > 0 ? <RefundForm invoiceId={invoiceId} payment={payment} /> : null}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
