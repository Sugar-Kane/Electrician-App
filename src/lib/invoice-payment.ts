/**
 * Recording a payment taken in hand: cash, a check, a card run outside the app.
 *
 * Invoices are not collected online, so until this existed an invoice could
 * never be marked paid and every job's last step stayed open forever. The
 * database function `record_invoice_payment` is the authority and applies the
 * same rules inside one transaction; this is the same rule read before the
 * round trip, so a typo is answered on the form rather than by an error.
 *
 * Import-free, so it can be tested without a database.
 */

import { parsePriceCents } from "./job-lines.ts";

export const PAYMENT_METHODS = [
  { value: "cash", label: "Cash" },
  { value: "check", label: "Check" },
  { value: "card", label: "Card" },
  { value: "other", label: "Other" },
] as const;

export type PaymentMethod = (typeof PAYMENT_METHODS)[number]["value"];

export function isPaymentMethod(value: string): value is PaymentMethod {
  return PAYMENT_METHODS.some((method) => method.value === value);
}

export type PayableInvoice = {
  status: string;
  totalCents: number;
  /** What is still owed. Falls back to the total for an invoice never paid against. */
  balanceDueCents: number | null;
  /** Set when Stripe collects the invoice; a payment is then recorded there, not here. */
  stripeInvoiceId?: string | null;
};

export type PaymentCheck =
  | { ok: true; amountCents: number; method: PaymentMethod; status: "paid" | "partially_paid"; balanceAfterCents: number }
  | { ok: false; reason: string };

/** What is owed on an invoice right now. */
export function amountOwedCents(invoice: PayableInvoice): number {
  return Math.max(0, invoice.balanceDueCents ?? invoice.totalCents ?? 0);
}

/**
 * Whether a payment can be recorded against this invoice, and what it leaves.
 *
 * Refused: a void, draft or already-paid invoice, one collected online, an unknown
 * method, an amount that cannot be read, is not positive, or is more than is
 * owed. Paying less than the balance is allowed and leaves it part paid.
 */
export function checkPayment(input: {
  invoice: PayableInvoice;
  method: string;
  amountText: string;
}): PaymentCheck {
  const { invoice } = input;
  if (invoice.status === "void") return { ok: false, reason: "This invoice is void." };
  if (invoice.status === "paid") return { ok: false, reason: "This invoice is already paid." };
  // A draft's lines can still change, so what it is owed is not settled yet.
  if (invoice.status === "draft") return { ok: false, reason: "Send the invoice before recording a payment on it." };
  if (invoice.stripeInvoiceId) {
    return { ok: false, reason: "This invoice is collected online, so its payment is recorded there." };
  }
  if (!isPaymentMethod(input.method)) return { ok: false, reason: "Choose how they paid." };

  const owed = amountOwedCents(invoice);
  if (owed <= 0) return { ok: false, reason: "Nothing is owed on this invoice." };

  const amountCents = parsePriceCents(input.amountText);
  if (amountCents === null) {
    return { ok: false, reason: "That amount could not be read. Try a figure like 1280 or 1280.50." };
  }
  if (amountCents <= 0) return { ok: false, reason: "The amount must be more than zero." };
  if (amountCents > owed) return { ok: false, reason: "That is more than is owed on this invoice." };

  const balanceAfterCents = owed - amountCents;
  return {
    ok: true,
    amountCents,
    method: input.method,
    status: balanceAfterCents === 0 ? "paid" : "partially_paid",
    balanceAfterCents,
  };
}
