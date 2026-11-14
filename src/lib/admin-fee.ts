/**
 * The admin fee: a percentage built into what the customer pays.
 *
 * The database adds it to each line as the line is written (the trigger in
 * 20261114010000_admin_fee_and_estimates.sql), so every total built from the
 * lines already includes it. These are the same rules for the places that
 * handle a dollar figure typed by hand rather than built from lines — an
 * invoice amount, ChatGPT's create_invoice — and for telling the business how
 * much of a total is the fee. The customer is never shown the split.
 *
 * Rates are basis points: 400 is 4%. Rounding matches Postgres `round()` on a
 * positive number: half a cent rounds up.
 *
 * Import-free, so the money rules can be tested on their own.
 */

/** The most a business can set: 20%. Matches the database check. */
export const MAX_ADMIN_FEE_BPS = 2000;

function rate(bps: number): number {
  if (!Number.isFinite(bps) || bps <= 0) return 0;
  return Math.min(MAX_ADMIN_FEE_BPS, Math.round(bps));
}

function cents(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

/** The fee on a price the business set, in cents. */
export function adminFeeOn(priceCents: number, bps: number): number {
  return Math.round((cents(priceCents) * rate(bps)) / 10000);
}

/** What the customer pays for a price the business set: the price with the fee in. */
export function withAdminFee(priceCents: number, bps: number): number {
  return cents(priceCents) + adminFeeOn(priceCents, bps);
}

/**
 * How much of a line's total is the fee.
 *
 * Worked from the line's two totals, with and without the fee, using the same
 * quantity rounding as the line itself, so the business's figure and the fee
 * always add up to exactly what the customer is charged.
 */
export function lineAdminFee(line: { quantity: number; unitPriceCents: number; adminFeeCents?: number | null }): number {
  const fee = cents(line.adminFeeCents ?? 0);
  if (fee === 0) return 0;
  const quantity = Number.isFinite(line.quantity) && line.quantity > 0 ? line.quantity : 0;
  const price = cents(line.unitPriceCents);
  const base = Math.max(0, price - fee);
  return Math.round(quantity * price) - Math.round(quantity * base);
}

/** The fee across a job's lines. */
export function linesAdminFee(lines: { quantity: number; unitPriceCents: number; adminFeeCents?: number | null }[]): number {
  return lines.reduce((sum, line) => sum + lineAdminFee(line), 0);
}

/** "4%", or "4.5%", for the business's screens. */
export function adminFeeLabel(bps: number): string {
  const percent = rate(bps) / 100;
  return `${Number.isInteger(percent) ? percent : percent.toFixed(2).replace(/0+$/, "")}%`;
}
