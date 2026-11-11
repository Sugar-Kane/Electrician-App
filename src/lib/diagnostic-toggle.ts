/**
 * Turning a job's diagnostic fee off, or back on, from Job settings.
 *
 * Every job is written with the business's diagnostic fee on it, and the fee
 * then shows on the job's contract and is credited on its invoice. Some jobs
 * should never carry one: a quote for work nobody visited for, a favour, a
 * returning customer. Off means a fee of zero, the same as a job booked from a
 * diagnostic, so contracts and invoices already know what to do with it.
 *
 * Import-free, so the rule can be tested without a database.
 */

export const STANDARD_DIAGNOSTIC_FEE_CENTS = 18_000;

export type DiagnosticFeeState = {
  /** What the job carries now, in cents. */
  feeCents: number;
  /** The customer has already paid it. */
  paid: boolean;
  /** Booked from a diagnostic: the fee belongs to the visit it follows. */
  followUp: boolean;
  canceled: boolean;
};

/** The fee to save, or why it cannot change. */
export function diagnosticFeeChange(
  job: DiagnosticFeeState,
  charge: boolean,
  businessFeeCents: number | null | undefined,
): { feeCents: number } | { error: string } {
  if (job.canceled) return { error: "This job is canceled. Cancelled jobs cannot be edited." };
  if (job.followUp) {
    return { error: "This job was booked from a diagnostic, so it has no diagnostic fee of its own: the fee was the visit before." };
  }
  if (job.paid && !charge) {
    return { error: "The customer has already paid the diagnostic fee. Refund it first; turning it off here would lose track of what they paid." };
  }
  if (!charge) return { feeCents: 0 };
  const fee = Number.isFinite(businessFeeCents) && Number(businessFeeCents) > 0 ? Math.round(Number(businessFeeCents)) : STANDARD_DIAGNOSTIC_FEE_CENTS;
  return { feeCents: job.feeCents > 0 ? Math.round(job.feeCents) : fee };
}
