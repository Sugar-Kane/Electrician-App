/**
 * What an invoice adds up to, and what Volteira takes.
 *
 * Two things happen here that did not before. The platform takes a percentage
 * of every invoice, and a diagnostic fee the customer has already paid is
 * credited against the work that followed it.
 *
 * All of it in integer cents. Money in floating point is how a $1,280.00
 * invoice becomes $1,279.99 on the third one, and the difference is small
 * enough that nobody notices until a customer adds up their year.
 *
 * Import-free, so the arithmetic can be tested exhaustively without a
 * database or a payment provider.
 */

/** Volteira's cut of each invoice, in basis points. 500 = 5%. */
export const PLATFORM_FEE_BASIS_POINTS = 500;

export type InvoiceInput = {
  /** The work, before anything is added or taken off. */
  subtotalCents: number;
  taxCents?: number;
  /**
   * The diagnostic fee this customer has already paid for this job.
   *
   * Zero when they have not paid one, or when this *is* the diagnostic
   * invoice — crediting a fee against the invoice that charges it would make
   * every diagnostic visit free.
   */
  diagnosticPaidCents?: number;
  /** Overridable so a business on different terms is a data change. */
  feeBasisPoints?: number;
};

export type InvoiceTotals = {
  subtotalCents: number;
  /** What was taken off for the already-paid diagnostic. Never negative. */
  diagnosticCreditCents: number;
  taxCents: number;
  /** What the customer owes. Never negative. */
  totalCents: number;
  /** Volteira's cut, taken by Stripe from the electrician's payout. */
  applicationFeeCents: number;
};

function whole(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  // Cents are integers. A fractional cent arriving here is a bug upstream, and
  // rounding it is better than propagating it into a total.
  return Math.round(value);
}

/**
 * The platform's cut of an amount.
 *
 * Rounded down, deliberately. On a fee split, the rounding half-cent should
 * fall to the business doing the work rather than to the platform taking a
 * percentage of it — and over thousands of invoices "always rounds up in our
 * favour" is a pattern somebody eventually notices.
 */
export function platformFeeCents(
  amountCents: number,
  basisPoints: number = PLATFORM_FEE_BASIS_POINTS,
): number {
  const amount = whole(amountCents);
  const rate = whole(basisPoints);
  if (amount <= 0 || rate <= 0) return 0;
  return Math.floor((amount * rate) / 10_000);
}

/**
 * Everything an invoice needs, worked out in one place.
 *
 * The order matters and is the order a customer would check it in: the work,
 * less what they already paid, plus tax on what is left. Taxing before the
 * credit would charge tax on money that is not being collected.
 */
export function invoiceTotals(input: InvoiceInput): InvoiceTotals {
  const subtotalCents = Math.max(0, whole(input.subtotalCents));
  const paid = Math.max(0, whole(input.diagnosticPaidCents));

  // The credit cannot exceed the work. A $75 job after a $100 diagnostic owes
  // nothing; it does not owe minus twenty-five dollars, and an invoice that
  // renders a negative total is a refund nobody authorised.
  const diagnosticCreditCents = Math.min(paid, subtotalCents);

  const taxCents = Math.max(0, whole(input.taxCents));
  const totalCents = Math.max(0, subtotalCents - diagnosticCreditCents + taxCents);

  // The fee is charged on what is actually collected. Charging it on the
  // pre-credit subtotal would bill the platform's percentage against money the
  // customer never pays.
  const applicationFeeCents = platformFeeCents(
    totalCents,
    input.feeBasisPoints ?? PLATFORM_FEE_BASIS_POINTS,
  );

  return {
    subtotalCents,
    diagnosticCreditCents,
    taxCents,
    totalCents,
    applicationFeeCents,
  };
}

/**
 * Whether this job's already-paid diagnostic should be credited here.
 *
 * Only against a *later* invoice. The diagnostic invoice itself charges the
 * fee, so crediting it there would net to nothing and every diagnostic visit
 * would be free.
 */
export function diagnosticCreditFor(input: {
  diagnosticPaid: boolean;
  diagnosticFeeCents: number;
  /** How many invoices this job already has. */
  existingInvoiceCount: number;
  /** Already credited on an earlier invoice for this job, in cents. */
  alreadyCreditedCents?: number;
}): number {
  if (!input.diagnosticPaid) return 0;
  if (input.existingInvoiceCount < 1) return 0;

  const fee = Math.max(0, whole(input.diagnosticFeeCents));
  const used = Math.max(0, whole(input.alreadyCreditedCents));

  // Credited once, however many follow-up invoices a job grows. A panel job
  // invoiced in three stages must not refund the diagnostic three times.
  return Math.max(0, fee - used);
}

/** Dollars for display, from cents. Never used for arithmetic. */
export function centsToDollars(cents: number): number {
  return whole(cents) / 100;
}
