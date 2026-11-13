/**
 * Refunding a payment on an invoice.
 *
 * A refund is always against one payment the invoice took: a card payment
 * made online goes back through Stripe, and one taken in hand (cash, a check,
 * a card run outside the app) is recorded as handed back. Never more than
 * that payment still holds, and only by somebody who may move the business's
 * money (owner or admin). The database function `begin_invoice_refund`
 * applies the same rules inside one transaction; this is the same rule read
 * before the round trip, so a typo is answered on the form.
 *
 * The invoice itself is not reopened: a refund gives money back, it does not
 * ask the customer for it again.
 *
 * Import-free apart from the price reader, so it can be tested without a
 * database.
 */

import { parsePriceCents } from "./job-lines.ts";

export type RefundStatus = "pending" | "succeeded" | "failed" | "canceled";

export type RefundRow = { amountCents: number; status: string };

/** Refunds that count against what a payment still holds: done, or on their way. */
function counts(refund: RefundRow): boolean {
  return refund.status === "succeeded" || refund.status === "pending";
}

/** What can still be refunded from a payment of `paymentCents`. */
export function refundableCents(paymentCents: number, refunds: RefundRow[]): number {
  const taken = refunds.filter(counts).reduce((total, refund) => total + Math.max(0, refund.amountCents), 0);
  return Math.max(0, Math.max(0, paymentCents) - taken);
}

export type RefundCheck = { ok: true; amountCents: number; full: boolean } | { ok: false; reason: string };

/**
 * Whether this refund can be made.
 *
 * Refused: somebody who is not the owner or an admin, a payment with nothing
 * left to refund, an amount that cannot be read, is not positive, or is more
 * than the payment still holds. A blank amount means all of what is left.
 */
export function checkRefund(input: {
  canRefund: boolean;
  paymentCents: number;
  refunds: RefundRow[];
  amountText: string;
}): RefundCheck {
  if (!input.canRefund) return { ok: false, reason: "Only the owner or an admin can give refunds." };
  const left = refundableCents(input.paymentCents, input.refunds);
  if (left <= 0) return { ok: false, reason: "This payment has already been refunded in full." };

  const typed = input.amountText.trim();
  const amountCents = typed === "" ? left : parsePriceCents(typed);
  if (amountCents === null) {
    return { ok: false, reason: "That amount could not be read. Try a figure like 180 or 180.50." };
  }
  if (amountCents <= 0) return { ok: false, reason: "The refund must be more than zero." };
  if (amountCents > left) return { ok: false, reason: "That is more than is left to refund on this payment." };
  return { ok: true, amountCents, full: amountCents === left };
}

/** Stripe's refund status, in the four this app keeps. */
export function refundStatusFromStripe(status: string | null | undefined): RefundStatus {
  switch (status) {
    case "succeeded":
      return "succeeded";
    case "failed":
      return "failed";
    case "canceled":
      return "canceled";
    default:
      // "pending" and "requires_action" are both still on their way.
      return "pending";
  }
}

export type RefundSummary = {
  paidCents: number;
  refundedCents: number;
  /** Refunds sent but not confirmed by Stripe yet. */
  pendingCents: number;
  /** What the business keeps: paid, less refunds done or on their way. */
  keptCents: number;
  /** Everything taken was given back. */
  refundedInFull: boolean;
};

/** An invoice's payments and refunds, as one line of money. */
export function refundSummary(payments: { amountCents: number }[], refunds: RefundRow[]): RefundSummary {
  const paidCents = payments.reduce((total, payment) => total + Math.max(0, payment.amountCents), 0);
  const refundedCents = refunds
    .filter((refund) => refund.status === "succeeded")
    .reduce((total, refund) => total + Math.max(0, refund.amountCents), 0);
  const pendingCents = refunds
    .filter((refund) => refund.status === "pending")
    .reduce((total, refund) => total + Math.max(0, refund.amountCents), 0);
  const keptCents = Math.max(0, paidCents - refundedCents - pendingCents);
  return { paidCents, refundedCents, pendingCents, keptCents, refundedInFull: paidCents > 0 && keptCents === 0 };
}

/**
 * Whether a refund receipt may go to the customer: only for money that really
 * went back. A card refund counts only once Stripe itself, asked just now,
 * says it succeeded; a refund handed back in person counts once it is
 * recorded as done. Anything pending, failed, canceled, or that Stripe has no
 * record of gets no receipt.
 */
export function refundReceiptAllowed(input: {
  /** Paid online, so the refund went back through Stripe. */
  online: boolean;
  /** Our record of the refund. */
  status: string;
  /** Stripe's id for it, when it went through Stripe. */
  stripeRefundId: string;
  /** What Stripe says now, for an online refund; null when it could not be asked or has no such refund. */
  stripeStatus: string | null;
}): { ok: true } | { ok: false; reason: string } {
  if (!input.online) {
    return input.status === "succeeded" ? { ok: true } : { ok: false, reason: "This refund is not recorded as done." };
  }
  if (!input.stripeRefundId) return { ok: false, reason: "Stripe has no refund for this payment, so there is nothing to send a receipt for." };
  if (input.stripeStatus === null) return { ok: false, reason: "Stripe could not confirm this refund right now. Try again in a minute." };
  if (input.stripeStatus !== "succeeded") {
    return {
      ok: false,
      reason:
        input.stripeStatus === "pending"
          ? "Stripe has not finished this refund yet. Send the receipt once it has gone through."
          : "Stripe did not complete this refund, so no receipt was sent.",
    };
  }
  return { ok: true };
}
