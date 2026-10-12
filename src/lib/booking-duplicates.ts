/**
 * Hiding booking requests that aren't work: a sales call, spam, a test, or the
 * same person asking twice.
 *
 * Hidden is not deleted. The row stays, with what it was hidden as, by whom and
 * when, and it can be brought back. What must never be hidden is anything that
 * became work or involves money: a job, a deposit, a payment, or a payment link
 * the customer may still use. Those need the job cancelled or the money
 * refunded, by a person, in the open.
 *
 * The database applies the same refusals when it hides a request; these are
 * here so the page offers only what will work, and so they can be tested.
 *
 * Import-free, so it can be tested without a database or a clock.
 */

export type HideableBooking = {
  id: string;
  organizationId: string;
  status: string;
  phone: string;
  email: string;
  /** ISO instant it arrived. */
  createdAt: string;
  jobId: string;
  depositPaidAt: string;
  paymentIntentId: string;
  /** Payment rows recorded against it, of any status. */
  paymentCount: number;
  archivedAt: string;
  /** Somebody looked at the suggestion and said these are different requests. */
  duplicateReviewedAt: string;
};

/** What a request can be hidden as, when it isn't a request for work. */
export const NOT_SERVICE = [
  { value: "sales", label: "Sales call" },
  { value: "spam", label: "Spam" },
  { value: "test", label: "Test" },
  { value: "other", label: "Something else" },
] as const;

export type NotServiceKind = (typeof NOT_SERVICE)[number]["value"];

export function notServiceLabel(value: string): string {
  return NOT_SERVICE.find((entry) => entry.value === value)?.label ?? "";
}

/** Two requests this close together, from the same number or address, look like one person asking twice. */
export const DUPLICATE_WINDOW_HOURS = 72;

/** The last ten digits of a phone number, or "" when there aren't ten. */
export function phoneKey(phone: string): string {
  const digits = phone.replace(/\D+/g, "");
  return digits.length >= 10 ? digits.slice(-10) : "";
}

export function emailKey(email: string): string {
  const value = email.trim().toLowerCase();
  return value.includes("@") ? value : "";
}

/** Whether two requests came from the same phone number or email address. */
export function sameContact(a: Pick<HideableBooking, "phone" | "email">, b: Pick<HideableBooking, "phone" | "email">): boolean {
  const phone = phoneKey(a.phone);
  const email = emailKey(a.email);
  return (phone !== "" && phone === phoneKey(b.phone)) || (email !== "" && email === emailKey(b.email));
}

/**
 * Why this request can't be hidden, or null when it can.
 *
 * The same answer whether it's being hidden as spam or as a duplicate: either
 * way it leaves the list, and a request with work or money behind it must not
 * leave quietly.
 */
export function hideRefusal(request: HideableBooking): string | null {
  if (request.archivedAt) return "It's already hidden.";
  if (request.jobId) return "It became a job, so it's real work. Cancel the job instead if it shouldn't happen.";
  if (request.paymentCount > 0 || request.depositPaidAt || request.paymentIntentId)
    return "Money was taken for it. Refund it first if it shouldn't stand.";
  if (request.status === "confirmed" || request.status === "scheduled") return "It's booked.";
  if (request.status === "awaiting_payment") return "A payment link is out, and the customer may still pay.";
  return null;
}

/**
 * Requests that look like the same person asking more than once.
 *
 * A pair qualifies when both are in one business, neither is hidden, they share
 * a phone number or email, they arrived within the window of each other, and
 * nobody has already said they're different. Pairs that touch are one group,
 * oldest first; the groups come newest first.
 */
export function duplicateGroups<T extends HideableBooking>(requests: T[], windowHours = DUPLICATE_WINDOW_HOURS): T[][] {
  const live = requests.filter((request) => !request.archivedAt && Number.isFinite(Date.parse(request.createdAt)));
  const parent = live.map((_, index) => index);
  const root = (index: number): number => {
    while (parent[index] !== index) {
      parent[index] = parent[parent[index]];
      index = parent[index];
    }
    return index;
  };
  const windowMs = windowHours * 60 * 60 * 1000;

  for (let i = 0; i < live.length; i += 1) {
    for (let j = i + 1; j < live.length; j += 1) {
      const a = live[i];
      const b = live[j];
      if (a.organizationId !== b.organizationId) continue;
      if (a.duplicateReviewedAt && b.duplicateReviewedAt) continue;
      if (Math.abs(Date.parse(a.createdAt) - Date.parse(b.createdAt)) > windowMs) continue;
      if (!sameContact(a, b)) continue;
      parent[root(i)] = root(j);
    }
  }

  const groups = new Map<number, T[]>();
  live.forEach((request, index) => {
    const key = root(index);
    groups.set(key, [...(groups.get(key) ?? []), request]);
  });

  const at = (request: T) => Date.parse(request.createdAt);
  return [...groups.values()]
    .filter((group) => group.length > 1)
    .map((group) => group.sort((a, b) => at(a) - at(b)))
    .sort((a, b) => at(b[b.length - 1]) - at(a[a.length - 1]));
}

/**
 * Keeping one request of a group, and hiding the rest as its duplicates.
 *
 * All or nothing: if any of the others can't be hidden, nothing is, and the
 * answer says which and why. Another business's request is never part of it.
 */
export function keepOne<T extends HideableBooking>(
  group: T[],
  keepId: string,
): { ok: true; keep: T; hide: T[] } | { ok: false; refusal: string } {
  const keep = group.find((request) => request.id === keepId);
  if (!keep) return { ok: false, refusal: "That request isn't one of these." };
  if (keep.archivedAt) return { ok: false, refusal: "The one to keep is hidden. Bring it back first." };

  const hide = group.filter((request) => request.id !== keepId);
  if (hide.length === 0) return { ok: false, refusal: "There's nothing else to hide." };
  for (const other of hide) {
    if (other.organizationId !== keep.organizationId) return { ok: false, refusal: "One of these belongs to another business." };
    if (!sameContact(keep, other)) return { ok: false, refusal: "These aren't from the same phone number or email." };
    const why = hideRefusal(other);
    if (why)
      return {
        ok: false,
        refusal: `Keeping this one would hide ${hide.length === 1 ? "the other" : "one of the others"}, which can't be: ${why.charAt(0).toLowerCase()}${why.slice(1)}`,
      };
  }
  return { ok: true, keep, hide };
}
