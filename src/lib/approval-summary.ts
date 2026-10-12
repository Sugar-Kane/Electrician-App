/**
 * The money at the top of what a customer is asked to approve.
 *
 * Read from the figures a contract saved when it was drawn up — the same ones
 * its words state — so the summary on the signing page, and the preview on the
 * job page before the link goes out, cannot say a different amount from the
 * contract under it.
 *
 * The one fee there is, is the diagnostic fee. Paid already, it comes off what
 * is left to pay; not paid, it is due before work begins. A fee larger than
 * the work leaves nothing to pay rather than a negative balance.
 *
 * Import-free, so the rule can be tested without a request.
 */

export type ContractFigures = {
  /** Null on a contract drawn up before figures were saved. */
  totalCents: number | null;
  depositCents: number | null;
  depositPaid: boolean | null;
};

export type ApprovalSummary = {
  totalCents: number;
  /** The diagnostic fee already paid, which comes off the total. */
  paidCents: number;
  /** What is left to pay for this work. Never below zero. */
  balanceCents: number;
  /** The diagnostic fee not yet paid, due before work begins. */
  dueBeforeWorkCents: number;
};

function cents(value: number | null): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
}

/** Null when the contract has no saved figures to summarise. */
export function approvalSummary(figures: ContractFigures): ApprovalSummary | null {
  if (figures.totalCents === null || figures.totalCents === undefined) return null;

  const total = cents(figures.totalCents);
  const fee = cents(figures.depositCents);
  const paid = figures.depositPaid === true ? fee : 0;

  return {
    totalCents: total,
    paidCents: paid,
    balanceCents: Math.max(0, total - paid),
    dueBeforeWorkCents: figures.depositPaid === true ? 0 : fee,
  };
}
