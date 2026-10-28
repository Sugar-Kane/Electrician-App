/**
 * Paying an invoice online, by bank (ACH) or card, from the customer's link.
 *
 * Two rules decide the money. What may be paid: only a sent, unpaid invoice,
 * only what is still owed, and not while a bank payment against it is still
 * clearing (that would take the money twice). And what each Stripe event
 * means: a card payment is paid the moment checkout completes, a bank payment
 * only when Stripe later says it cleared, and a bank payment can still fail.
 *
 * Import-free, so both are tested without Stripe or a database.
 */

export type OnlineAttemptStatus = "open" | "processing" | "succeeded" | "failed" | "expired";

export type PayableOnline = {
  status: string;
  lastSentAt: string | null;
  totalCents: number;
  /** What is still owed. Falls back to the total for an invoice never paid against. */
  balanceDueCents: number | null;
  /** Earlier online attempts on this invoice, newest first. */
  attempts: { status: OnlineAttemptStatus; amountCents: number }[];
};

/** Stripe's smallest charge in US dollars. */
export const MIN_ONLINE_CENTS = 50;

export type OnlinePayCheck =
  | { ok: true; amountCents: number }
  | { ok: false; reason: "draft" | "void" | "paid" | "nothing_owed" | "processing" | "too_small"; processingCents?: number };

export function owedCents(invoice: Pick<PayableOnline, "balanceDueCents" | "totalCents">): number {
  return Math.max(0, Math.round(invoice.balanceDueCents ?? invoice.totalCents ?? 0));
}

/** Whether the customer may pay this invoice online now, and how much. */
export function checkOnlinePayment(invoice: PayableOnline): OnlinePayCheck {
  if (invoice.status === "void") return { ok: false, reason: "void" };
  if (invoice.status === "paid") return { ok: false, reason: "paid" };
  // A draft (even one previewed) is not a bill yet: its lines can still change.
  if (invoice.status === "draft") return { ok: false, reason: "draft" };

  const processing = invoice.attempts.filter((attempt) => attempt.status === "processing");
  if (processing.length > 0) {
    return { ok: false, reason: "processing", processingCents: processing.reduce((sum, attempt) => sum + attempt.amountCents, 0) };
  }

  const amountCents = owedCents(invoice);
  if (amountCents <= 0) return { ok: false, reason: "nothing_owed" };
  if (amountCents < MIN_ONLINE_CENTS) return { ok: false, reason: "too_small" };
  return { ok: true, amountCents };
}

/** What a Stripe checkout event means for an invoice's online payment. */
export type OnlineEventAction = "settle" | "processing" | "failed" | "expired" | "ignore";

export function onlineEventAction(eventType: string, paymentStatus: string | null | undefined): OnlineEventAction {
  switch (eventType) {
    case "checkout.session.completed":
      // A card is paid at once. A bank debit completes checkout "unpaid": it
      // was submitted and is clearing, and nothing is owed less until it clears.
      if (paymentStatus === "paid") return "settle";
      return paymentStatus === "unpaid" ? "processing" : "ignore";
    case "checkout.session.async_payment_succeeded":
      return "settle";
    case "checkout.session.async_payment_failed":
      return "failed";
    case "checkout.session.expired":
      return "expired";
    default:
      return "ignore";
  }
}

/**
 * Whether an attempt may move to a new status. A cleared payment never goes
 * back, and an event arriving late (an expiry after the payment was submitted)
 * does not undo a later one.
 */
export function canMoveAttempt(from: OnlineAttemptStatus, to: OnlineAttemptStatus): boolean {
  if (from === to) return false;
  if (from === "succeeded") return false;
  switch (to) {
    case "processing":
      return from === "open";
    case "failed":
      return from === "open" || from === "processing";
    case "expired":
      return from === "open";
    case "succeeded":
      return from === "open" || from === "processing" || from === "failed";
    default:
      return false;
  }
}

/** The payment method as the invoice records it, from Stripe's payment method type. */
export function methodFromStripeType(type: string | null | undefined): "bank" | "card" {
  return type === "us_bank_account" ? "bank" : "card";
}
