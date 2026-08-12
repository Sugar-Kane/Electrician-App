/**
 * Whether a drag across a row was somebody reaching for delete.
 *
 * Pulled out of the component because it is the whole of the gesture and none
 * of it is visible in a screenshot. A swipe that also fires while somebody
 * scrolls a list of invoices with their thumb is not a worse-looking feature,
 * it is a delete button appearing under a finger that was going somewhere else.
 *
 * Import-free, so the awkward cases — the diagonal thumb, the swipe back, the
 * tap that moves three pixels — can be tested without a browser.
 */

export type SwipePoint = { x: number; y: number };

/** Far enough to be deliberate; a thumb wobbles about twenty pixels. */
export const SWIPE_THRESHOLD = 56;

export type SwipeIntent = "open" | "close" | "none";

export function swipeIntent(
  from: SwipePoint | null,
  to: SwipePoint | null,
  threshold = SWIPE_THRESHOLD,
): SwipeIntent {
  if (!from || !to) return "none";

  // Positive is leftward, which is the direction that reveals the button — the
  // same way every mail app on both platforms does it.
  const sideways = from.x - to.x;
  const vertical = Math.abs(from.y - to.y);

  // Sideways has to beat the vertical travel as well as the threshold. Nobody
  // scrolls a phone in a perfectly straight line, so without this a flick down
  // a long list peels open every row it passes.
  if (Math.abs(sideways) <= vertical) return "none";

  if (sideways >= threshold) return "open";
  if (sideways <= -threshold) return "close";
  return "none";
}
