/** Where a link to a job's contract points: `/jobs/12#contract`. */
export const CONTRACT_ANCHOR = "contract";

/**
 * Open the job's contracts, so a link to them lands on them.
 *
 * The job page folds a job's contracts away under the Contract heading, and a
 * link that lands on that heading with the drafts still folded has landed on
 * nothing. Neither Next's scroll-to-hash nor every browser opens a `<details>`
 * on the way, so it is opened first.
 *
 * Browser-only: called from a tap and from an effect, never while rendering.
 */
export function revealContract() {
  const details = document.getElementById(CONTRACT_ANCHOR)?.querySelector(":scope > details");
  if (details instanceof HTMLDetailsElement && !details.open) details.open = true;
}
