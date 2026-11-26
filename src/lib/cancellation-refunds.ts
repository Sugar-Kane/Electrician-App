/**
 * Returning everything a customer paid after they cancel a home improvement
 * contract (the cancellation notice: returned within 10 days; compliance
 * CSLB-007-007). The owner presses one button; this decides what it does:
 * every payment on the job with money still unreturned is refunded in full,
 * to the card or bank it came from when Stripe took it, otherwise recorded as
 * returned by hand (cash or check the owner gives back).
 *
 * Import-free, so the rule is tested directly.
 */

export type PaidOnJob = {
  id: string;
  /** An invoice payment, or a payment taken before the invoice (a deposit). */
  source: "invoice" | "prepayment";
  method: string;
  amountCents: number;
  /** Already refunded, or on its way (pending), against this payment. */
  refundedCents: number;
  /** Stripe took it, so Stripe can return it. */
  viaStripe: boolean;
};

export type RefundStep = { id: string; source: PaidOnJob["source"]; amountCents: number; how: "stripe" | "by_hand" };

const whole = (value: number) => (Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0);

export function cancellationRefundSteps(payments: readonly PaidOnJob[]): RefundStep[] {
  return payments
    .map((payment) => ({
      id: payment.id,
      source: payment.source,
      amountCents: Math.max(0, whole(payment.amountCents) - whole(payment.refundedCents)),
      how: payment.viaStripe ? ("stripe" as const) : ("by_hand" as const),
    }))
    .filter((step) => step.amountCents > 0);
}

/** Nothing left to return. */
export function refundsComplete(payments: readonly PaidOnJob[]): boolean {
  return cancellationRefundSteps(payments).length === 0;
}

/** What is still owed back, in cents. */
export function owedBackCents(payments: readonly PaidOnJob[]): number {
  return cancellationRefundSteps(payments).reduce((sum, step) => sum + step.amountCents, 0);
}
