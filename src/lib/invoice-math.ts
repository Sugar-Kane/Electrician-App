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

/** Volteira's cut of each customer payment, in basis points. 100 = 1%. */
export const PLATFORM_FEE_BASIS_POINTS = 100;

/**
 * A discount the business gives on an invoice: a percentage of the work, or a
 * fixed amount off it. One or the other, never both — an invoice carries one
 * discount, and a second would be a discount on a discount nobody can check.
 *
 * Percentages are basis points, as every rate here is: 1000 is 10%, 1250 is
 * 12.5%. Fixed amounts are cents.
 */
export type InvoiceDiscount =
  | { type: "percentage"; basisPoints: number }
  | { type: "fixed"; cents: number };

/** The whole of the work. A percentage above it is refused, not capped. */
export const MAX_DISCOUNT_BASIS_POINTS = 10_000;

export type InvoiceInput = {
  /** The work, before anything is added or taken off. */
  subtotalCents: number;
  /**
   * Taken off the work before anything else: before the diagnostic credit and
   * before tax. Tax is carried as entered (nothing here knows a rate), so a
   * discount that changes what is taxable is a reason to check the tax.
   */
  discount?: InvoiceDiscount | null;
  taxCents?: number;
  /**
   * The diagnostic fee this customer has already paid for this job, and that
   * no earlier invoice has taken off yet. Zero when they have not paid one.
   */
  diagnosticPaidCents?: number;
  /** Overridable so a business on different terms is a data change. */
  feeBasisPoints?: number;
};

export type InvoiceTotals = {
  subtotalCents: number;
  /** What the discount took off the work. Zero when there is none. Never more than the work. */
  discountCents: number;
  /**
   * A fixed discount larger than the work it is taken from, held to the work.
   * Happens when the work shrinks after the discount was set (a change order
   * that removes something); the screen says so rather than letting it pass.
   */
  discountCapped: boolean;
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

  // The discount first: it is the price of the work, as agreed. The credit for
  // money already paid comes off what is left of it, never off the list price.
  const { cents: discountCents, capped: discountCapped } = discountOn(subtotalCents, input.discount);
  const discountedCents = subtotalCents - discountCents;

  // The credit cannot exceed the work. A $75 job after a $100 diagnostic owes
  // nothing; it does not owe minus twenty-five dollars, and an invoice that
  // renders a negative total is a refund nobody authorised.
  const diagnosticCreditCents = Math.min(paid, discountedCents);

  const taxCents = Math.max(0, whole(input.taxCents));
  const totalCents = Math.max(0, discountedCents - diagnosticCreditCents + taxCents);

  // The fee is charged on what is actually collected. Charging it on the
  // pre-credit subtotal would bill the platform's percentage against money the
  // customer never pays.
  const applicationFeeCents = platformFeeCents(
    totalCents,
    input.feeBasisPoints ?? PLATFORM_FEE_BASIS_POINTS,
  );

  return {
    subtotalCents,
    discountCents,
    discountCapped,
    diagnosticCreditCents,
    taxCents,
    totalCents,
    applicationFeeCents,
  };
}

/**
 * What a discount takes off an amount, in cents.
 *
 * A percentage rounds half up, once, on the whole amount — 10% of $10.05 is
 * $1.01 — and is recalculated whenever the amount changes, so a change order
 * that adds $500 adds $50 to a 10% discount. A fixed amount stays what was
 * agreed, and is held to the amount when the work shrinks below it, so the
 * invoice can never go negative; `capped` says when that happened.
 */
export function discountOn(
  amountCents: number,
  discount: InvoiceDiscount | null | undefined,
): { cents: number; capped: boolean } {
  const amount = Math.max(0, whole(amountCents));
  if (!discount || amount === 0) return { cents: 0, capped: false };

  if (discount.type === "percentage") {
    const rate = Math.min(MAX_DISCOUNT_BASIS_POINTS, Math.max(0, whole(discount.basisPoints)));
    // Integer arithmetic: + 5,000 then floor is half up on a positive amount.
    return { cents: Math.floor((amount * rate + 5_000) / 10_000), capped: false };
  }

  const fixed = Math.max(0, whole(discount.cents));
  return fixed > amount ? { cents: amount, capped: true } : { cents: fixed, capped: false };
}

/** The discount an invoice row carries, or null when it has none. */
export function discountFromRow(row: { discount_type?: unknown; discount_value?: unknown }): InvoiceDiscount | null {
  const value = typeof row.discount_value === "string" ? Number(row.discount_value) : row.discount_value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;
  if (row.discount_type === "percentage") return { type: "percentage", basisPoints: whole(value) };
  if (row.discount_type === "fixed") return { type: "fixed", cents: whole(value) };
  return null;
}

/** The columns a discount is stored in: both null when there is none. */
export function discountColumns(discount: InvoiceDiscount | null): {
  discount_type: "percentage" | "fixed" | null;
  discount_value: number | null;
} {
  if (!discount) return { discount_type: null, discount_value: null };
  return discount.type === "percentage"
    ? { discount_type: "percentage", discount_value: whole(discount.basisPoints) }
    : { discount_type: "fixed", discount_value: whole(discount.cents) };
}

export type DiscountChoice = "percentage" | "fixed" | "none";

/**
 * A discount as somebody typed it, checked against the work it comes off.
 *
 * "10" or "12.5" for a percentage (up to two decimal places, 0–100), "$150" or
 * "150.00" for an amount. A fixed amount larger than the work is refused rather
 * than capped: the person typing it can see the subtotal, and a number they
 * did not mean is better corrected than quietly shrunk. Zero is no discount.
 */
export function readDiscount(input: {
  type: string;
  value: string;
  eligibleCents: number;
}): { ok: true; discount: InvoiceDiscount | null } | { ok: false; reason: string } {
  const type = input.type;
  if (type === "none" || type === "") return { ok: true, discount: null };
  const raw = (input.value ?? "").trim().replace(/[%\s]/g, "");

  if (type === "percentage") {
    if (!/^\d+(\.\d{1,2})?$/.test(raw)) {
      return { ok: false, reason: "Enter the discount as a percentage, like 10 or 12.5." };
    }
    // Whole basis points from the digits, never from a float multiply.
    const [units = "0", fraction = ""] = raw.split(".");
    const basisPoints = Number(units) * 100 + Number((fraction + "00").slice(0, 2));
    if (basisPoints > MAX_DISCOUNT_BASIS_POINTS) return { ok: false, reason: "A percentage discount can be at most 100%." };
    return { ok: true, discount: basisPoints === 0 ? null : { type: "percentage", basisPoints } };
  }

  if (type === "fixed") {
    const cleaned = raw.replace(/[$,]/g, "");
    if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) {
      return { ok: false, reason: "Enter the discount as an amount, like 150 or 150.00." };
    }
    const [units = "0", fraction = ""] = cleaned.split(".");
    const cents = Number(units) * 100 + Number((fraction + "00").slice(0, 2));
    if (cents > Math.max(0, whole(input.eligibleCents))) {
      return { ok: false, reason: "The discount cannot be more than the invoice subtotal." };
    }
    return { ok: true, discount: cents === 0 ? null : { type: "fixed", cents } };
  }

  return { ok: false, reason: "Choose a percentage, a fixed amount, or no discount." };
}

/** "Discount (10%)", "Discount (12.5%)" or "Discount", as it is printed. */
export function discountLabel(discount: InvoiceDiscount | null): string {
  if (!discount || discount.type === "fixed") return "Discount";
  const percent = whole(discount.basisPoints) / 100;
  return `Discount (${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, "")}%)`;
}

/**
 * How much of this job's already-paid diagnostic to take off this invoice.
 *
 * From the job's first invoice on. This used to skip the first one, on the
 * theory that the first invoice *was* the diagnostic — but a job is only ever
 * marked `diagnostic_paid` by the customer paying for the visit when they
 * booked, which raises no invoice at all. Skipping the first one billed every
 * customer who paid up front for the diagnostic a second time.
 */
export function diagnosticCreditFor(input: {
  diagnosticPaid: boolean;
  diagnosticFeeCents: number;
  /** Already credited on an earlier invoice for this job, in cents. */
  alreadyCreditedCents?: number;
}): number {
  if (!input.diagnosticPaid) return 0;

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
