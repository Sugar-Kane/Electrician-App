/**
 * What a job's hours and parts add up to.
 *
 * Until now a job had no lines at all, and an invoice's subtotal was a number
 * somebody typed. So the invoice and the work it billed for could disagree and
 * nothing in the system would know which was right.
 *
 * These sums feed `invoiceTotals` in ./invoice-math.ts, which already handles
 * the platform fee and the diagnostic credit — so the total a customer sees is
 * derived from the work all the way down.
 *
 * Import-free, so quantities like 1.5 hours and 30.5 feet can be tested against
 * integer-cent prices without a database.
 */

export type LineKind = "labor" | "material";

export type JobLine = {
  id: string;
  kind: LineKind;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  /** Set when the line was filled from stock the business already owns. */
  inventoryItemId?: string | null;
  notes?: string;
};

export type JobLineTotals = {
  laborCents: number;
  materialCents: number;
  subtotalCents: number;
  lineCount: number;
};

function whole(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

function positiveQuantity(value: number | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return 0;
  return value;
}

/**
 * One line's worth, in cents.
 *
 * The unit price is forced to whole cents first, the same as everywhere else
 * money is handled here — `unit_price_cents` is an integer column, so a
 * fraction arriving is a bug upstream rather than a real half-cent price.
 *
 * The product is then rounded too, and that rounding is the real one: 1.5 hours
 * at $9.99 is $14.985, and somebody has to decide which cent that is.
 *
 * A quantity that cannot be read is worth zero rather than one. Guessing "they
 * probably meant one" on a $900 panel is a worse failure than a visible zero.
 */
export function lineTotalCents(line: {
  quantity: number;
  unitPriceCents: number;
}): number {
  const quantity = positiveQuantity(line.quantity);
  const price = Math.max(0, whole(line.unitPriceCents));
  if (quantity === 0 || price === 0) return 0;
  return Math.round(quantity * price);
}

/**
 * The job's totals, split by kind.
 *
 * Labor and materials are summed separately as well as together because that
 * split is the one an electrician is asked for — by a customer querying a bill,
 * and by their own accountant at the end of a quarter.
 */
export function jobLineTotals(lines: JobLine[]): JobLineTotals {
  const safe = Array.isArray(lines) ? lines : [];

  let laborCents = 0;
  let materialCents = 0;

  for (const line of safe) {
    const total = lineTotalCents(line);
    if (line?.kind === "labor") laborCents += total;
    else materialCents += total;
  }

  return {
    laborCents,
    materialCents,
    subtotalCents: laborCents + materialCents,
    lineCount: safe.length,
  };
}

/**
 * A quantity as somebody typed it.
 *
 * "1.5", "1 1/2" and "90 ft" all mean something to an electrician standing at a
 * van. The last of those is the common one — a unit typed into the quantity box
 * because that is how the number is said out loud.
 *
 * Returns null rather than a guess when it cannot be read, so a caller can
 * refuse the line instead of silently billing for zero.
 */
export function parseQuantity(input: string): number | null {
  const text = (input ?? "").trim();
  if (!text) return null;

  // "1 1/2" and "1/2" — halves and quarters are how hours get said.
  const mixed = /^(?:(\d+)\s+)?(\d+)\s*\/\s*(\d+)/.exec(text);
  if (mixed) {
    const denominator = Number(mixed[3]);
    if (denominator === 0) return null;
    const value = Number(mixed[1] ?? 0) + Number(mixed[2]) / denominator;
    return value > 0 ? value : null;
  }

  // A leading number, ignoring any unit that trails it.
  const plain = /^(\d+(?:\.\d+)?)/.exec(text);
  if (!plain) return null;

  const value = Number(plain[1]);
  if (!Number.isFinite(value) || value <= 0) return null;

  // Three decimals is what the column stores; more is a typo, not a measurement.
  return Math.round(value * 1000) / 1000;
}

/**
 * A price as somebody typed it, in cents.
 *
 * "$1,289.00", "1289", "1,289" are all the same price. Currency symbols and
 * thousands separators are stripped because a form that rejects "$" is a form
 * that gets fought with on a phone keyboard.
 *
 * Null when unreadable — the same refusal as parseQuantity, for the same
 * reason. A price that silently becomes zero is an invoice that undercharges.
 */
export function parsePriceCents(input: string): number | null {
  const text = (input ?? "").trim();
  if (!text) return null;

  const cleaned = text.replace(/[$\s,]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;

  const value = Number(cleaned);
  if (!Number.isFinite(value) || value < 0) return null;

  return Math.round(value * 100);
}

/** Cents as "$1,289.00", for a screen. Never fed back into arithmetic. */
export function formatCents(cents: number): string {
  const value = whole(cents) / 100;
  return value.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

/**
 * A quantity as it should read on a line.
 *
 * Trailing zeros removed, because "2.000 each" looks like a machine wrote it
 * and "2 each" looks like a person did.
 */
export function formatQuantity(quantity: number): string {
  const value = positiveQuantity(quantity);
  if (value === 0) return "0";
  return String(Math.round(value * 1000) / 1000);
}
