/** Where a link to a job's contract points: `/jobs/12#contract`. */
export const CONTRACT_ANCHOR = "contract";

/**
 * Open whatever the contract is folded into, so a link to it lands on it.
 *
 * The job page keeps the contract inside the closed "More job details"
 * section, and a fragment pointing into a closed `<details>` goes nowhere: the
 * contract has no layout to scroll to, and neither Next's scroll-to-hash nor
 * every browser opens the section on the way. So it is opened first.
 *
 * Browser-only: called from a tap and from an effect, never while rendering.
 */
export function revealContract() {
  const details = document.getElementById(CONTRACT_ANCHOR)?.closest("details");
  if (details && !details.open) details.open = true;
}
