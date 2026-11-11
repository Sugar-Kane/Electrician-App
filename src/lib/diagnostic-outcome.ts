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
