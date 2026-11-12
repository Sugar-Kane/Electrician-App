/**
 * What a diagnostic visit ends in, and whether its fee goes on the job as a
 * line so it can be billed.
 *
 * Three ways a diagnostic ends:
 * - `diagnostic_only`: no repair. The customer owes the diagnostic fee, if it
 *   was not paid when they booked.
 * - `fix_now`: the fix is done on this visit (a store run included). The repair
 *   is billed on top of the fee. The fee line always goes on, paid or not: a fee
 *   paid at booking is taken off the invoice as a credit (invoice-math.ts), so
 *   without its line the credit would come off the repair instead.
 * - `schedule_later`: the job is bigger than one visit and becomes a linked
 *   work order. The fee is billed here only if it is still owed; a paid fee is
 *   credited on the work order.
 *
 * Never a second fee line, and never one on a job booked from a diagnostic
 * (its fee was the visit before) or with no fee at all.
 *
 * Import-free, so the rule can be tested without a database.
 */

export type DiagnosticOutcome = "diagnostic_only" | "fix_now" | "schedule_later";

export const DIAGNOSTIC_FEE_LINE = "Diagnostic fee";

export function isDiagnosticOutcome(value: unknown): value is DiagnosticOutcome {
  return value === "diagnostic_only" || value === "fix_now" || value === "schedule_later";
}

export function diagnosticFeeLineNeeded(
  outcome: DiagnosticOutcome,
  job: { feeCents: number; paid: boolean; followUpOf: string | null; hasFeeLine: boolean },
): boolean {
  if (job.hasFeeLine || job.followUpOf || !(job.feeCents > 0)) return false;
  if (outcome === "fix_now") return true;
  return !job.paid;
}

export type FeeInvoiceStanding = "to_bill" | "billed_unpaid" | "paid" | "none";

/**
 * Where a diagnostic's own fee stands, before the visit and after.
 *
 * - `none`: nothing to collect here. No fee, it was paid when they booked, or
 *   the job is a follow-up (its fee was the visit before).
 * - `to_bill`: owed and not sent yet (on no invoice, a void one, or a draft
 *   that never went out), so the first thing to do once the job is made is
 *   send the fee invoice.
 * - `billed_unpaid`: on an invoice that has not been paid yet.
 * - `paid`: paid on its invoice.
 *
 * A fee line on a void invoice is not billed.
 */
export function feeInvoiceStanding(job: {
  feeCents: number;
  paidAtBooking: boolean;
  followUpOf: string | null;
  /** The status of the live invoice holding the fee line, or null when it is on none. */
  feeInvoiceStatus: string | null;
}): FeeInvoiceStanding {
  if (!(job.feeCents > 0) || job.paidAtBooking || job.followUpOf) return "none";
  const status = job.feeInvoiceStatus;
  if (!status || status === "void" || status === "draft") return "to_bill";
  return status === "paid" ? "paid" : "billed_unpaid";
}
