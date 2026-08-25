/**
 * Sorting requests into what is waiting and what is done with.
 *
 * The page grew two lists — "waiting on you" and "already handled" — and the
 * second one kept everything forever, open by default, under the first. So the
 * queue of things needing an answer sat above a growing pile of things that did
 * not, and after a fortnight the pile was the page.
 *
 * Two rules fix that. What is done with is folded away, and it ages out after a
 * week — long enough to answer "what did we do last Tuesday", short enough that
 * the screen stays about now. What is *not* done with never ages out, however
 * long it has been sitting there, because a request nobody answered in March is
 * exactly the one that must not disappear quietly.
 *
 * Import-free, so the rules can be tested without a database or a clock.
 */

/**
 * Still waiting on a person.
 *
 * `awaiting_payment` and `safety_escalated` are in here, and were not before.
 * Both were filed as handled, which is how a customer who never paid and a
 * hazard somebody escalated both ended up greyed out at the bottom of the page
 * with their buttons hidden — the two states most in need of a person.
 */
const OPEN_STATUSES = new Set([
  "new",
  "needs_review",
  "awaiting_payment",
  "safety_escalated",
]);

export function isOpenRequest(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

/** A week. Long enough to look back over, short enough to stay about now. */
export const HANDLED_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

export type QueueEntry = {
  status: string;
  /** When it arrived, as an ISO instant. Empty is treated as long ago. */
  receivedAt: string;
};

export type SplitQueue<T> = {
  /** Waiting on somebody. Never hidden, never aged out. */
  open: T[];
  /** Done with, and recent enough to still be worth showing. */
  handled: T[];
  /** Done with and older than a week. Counted, not listed. */
  agedOut: number;
};

/**
 * Split a queue into what needs answering and what does not.
 *
 * `now` is passed in rather than read, so the boundary can be tested and so a
 * server rendering in UTC and a phone in California agree about which requests
 * are a week old.
 */
export function splitQueue<T extends QueueEntry>(requests: T[], now: number): SplitQueue<T> {
  const cutoff = now - HANDLED_DAYS * DAY_MS;

  const open: T[] = [];
  const handled: T[] = [];
  let agedOut = 0;

  for (const request of requests) {
    if (isOpenRequest(request.status)) {
      open.push(request);
      continue;
    }

    const at = Date.parse(request.receivedAt);
    // An unparseable date is treated as old rather than as new: a row with no
    // timestamp is not evidence that something just came in.
    if (!Number.isFinite(at) || at < cutoff) {
      agedOut += 1;
      continue;
    }

    handled.push(request);
  }

  return { open, handled, agedOut };
}
