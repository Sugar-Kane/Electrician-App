/**
 * The decision rules behind messaging, kept free of imports so they can be
 * tested directly.
 *
 * Everything here shipped broken once. The quiet-hours window was unreachable,
 * delivery callbacks could walk a message backwards, commercial customers had
 * no name, and inbound matching had no test at all. Pure functions in one file
 * is what makes those cheap to pin down.
 */

export type ConsentFacts = { optedInAt: string | null; optedOutAt: string | null };

export type QuietHoursWindow = {
  start: string;
  end: string;
  timezone: string;
  currentlyQuiet: boolean;
};

/** A STOP writes opted_out_at rather than deleting the row, so both matter. */
export function consentIsActive(consent: ConsentFacts): boolean {
  return Boolean(consent.optedInAt) && !consent.optedOutAt;
}

export type CallbackConsentStep =
  | { record: boolean; mayText: true }
  | { record: false; mayText: false; reason: string };

/**
 * Before texting a caller that their callback is noted.
 *
 * Somebody who rang the business and asked to be called back has given their
 * number for that, which is recorded as verbal consent when nothing is on file.
 * It never undoes a STOP: the row's opt-out stands until the customer texts
 * START themselves. `existing` is the customer's current row, or null.
 */
export function callbackConsentStep(existing: ConsentFacts | null): CallbackConsentStep {
  if (existing?.optedOutAt) {
    return { record: false, mayText: false, reason: "They replied STOP earlier, so the confirmation was not texted." };
  }
  if (existing && consentIsActive(existing)) return { record: false, mayText: true };
  return { record: true, mayText: true };
}

/**
 * Whether a text from a customer the business already has on file is their
 * opt-in.
 *
 * Texting the business first is consent for a number nobody has seen before
 * (the inbound route records it as it makes the customer). The same holds for
 * a customer the business added itself, by the job page or from ChatGPT, who
 * has never been asked: nothing on file means their own text is the first
 * word on it. It never undoes a STOP, which only START reverses, and an
 * active opt-in needs nothing written. `existing` is the row, or null.
 */
export function firstTextOptsIn(existing: ConsentFacts | null): boolean {
  if (!existing) return true;
  if (existing.optedOutAt) return false;
  return !existing.optedInAt;
}

export type ManualConsentStep =
  | { write: "insert" | "update"; already: false }
  | { write: null; already: true }
  | { write: null; already: false; refused: string };

/**
 * Recording that a customer gave the business their mobile number for service.
 *
 * Written automatically when the owner enters a number for a job: a customer
 * who hands over their number for an appointment expects texts about it. It
 * never undoes a STOP: only the customer texting START does. `existing` is the
 * customer's current row, or null. "update" fills a row that holds neither
 * date, and must be written only while both are still empty, so a STOP landing
 * in between is not overwritten.
 */
export function manualConsentStep(existing: ConsentFacts | null): ManualConsentStep {
  if (!existing) return { write: "insert", already: false };
  if (existing.optedOutAt) {
    return {
      write: null,
      already: false,
      refused: "This customer replied STOP. Only they can turn texts back on, by texting START.",
    };
  }
  if (existing.optedInAt) return { write: null, already: true };
  return { write: "update", already: false };
}

/**
 * Why a text may not go to this customer, or null when it may: the one rule
 * `sendSms` applies to every text.
 *
 * Only a STOP refuses. That one is the law and the carriers' rule, and a
 * customer who asked not to be texted is never texted until they text START.
 * Nothing else stands in the way of the business working: no record is not a
 * refusal (the customer gave the number for service), and neither is a record
 * that could not be read, because Twilio's own opt-out list stops a STOP'd
 * number at the carrier regardless (error 21610, which then updates the ledger).
 */
export function textRefusal(consent: ConsentFacts | null | "unknown"): string | null {
  if (!consent || consent === "unknown" || !consent.optedOutAt) return null;
  // An opt-in after the STOP (they texted START) is their latest word.
  const out = Date.parse(consent.optedOutAt);
  const back = consent.optedInAt ? Date.parse(consent.optedInAt) : Number.NaN;
  if (Number.isFinite(back) && back > out) return null;
  return "This customer replied STOP, so no text was sent. Only they can turn texts back on, by texting START.";
}

/**
 * Why this customer cannot be texted, or null when they can.
 *
 * Returned as prose because it is shown to staff in place of the composer:
 * refusing to send without saying why is how people end up retrying forever.
 */
export function blockedReasonFor(input: {
  consent: ConsentFacts;
  hasMessagingService: boolean;
}): string | null {
  // The same rule as sendSms: only a STOP stops a text.
  const refused = textRefusal(input.consent);
  if (refused) return refused;
  if (!input.hasMessagingService) {
    return "No messaging service is connected for this business yet.";
  }
  return null;
}

function minutesInto(value: string): number {
  const [hours, mins] = value.split(":");
  return Number(hours) * 60 + Number(mins);
}

/**
 * Quiet hours are wall-clock times in the business's timezone, and the default
 * window (21:00 to 08:00) crosses midnight — the wrapping case is the normal
 * one, not an edge case.
 */
export function evaluateQuietHours(
  start: string,
  end: string,
  timezone: string,
  now: Date = new Date(),
): QuietHoursWindow {
  const localTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);

  const current = minutesInto(localTime);
  const from = minutesInto(start);
  const to = minutesInto(end);
  const currentlyQuiet =
    from > to ? current >= from || current < to : current >= from && current < to;

  return { start, end, timezone, currentlyQuiet };
}

/**
 * A customer is a person, a company, or both: the table only requires one of
 * the three name columns.
 */
export function displayNameFor(customer: {
  first_name?: unknown;
  last_name?: unknown;
  company_name?: unknown;
}): string {
  const asText = (value: unknown) => (typeof value === "string" ? value : "");
  const person = `${asText(customer.first_name)} ${asText(customer.last_name)}`.trim();
  return person || asText(customer.company_name) || "Unknown customer";
}

export function initialsFor(customer: {
  first_name?: unknown;
  last_name?: unknown;
  company_name?: unknown;
}): string {
  const asText = (value: unknown) => (typeof value === "string" ? value : "");
  const first = asText(customer.first_name);
  const last = asText(customer.last_name);
  if (first || last) return `${first.charAt(0)}${last.charAt(0)}`.toUpperCase();
  const company = asText(customer.company_name);
  return company ? company.slice(0, 2).toUpperCase() : "?";
}

/**
 * Phone numbers are stored as typed and arrive from Twilio in E.164, so
 * matching is on the last ten digits rather than on string equality.
 */
export function phoneMatches(stored: string, incoming: string): boolean {
  const digits = (value: string) => value.replace(/\D/g, "").slice(-10);
  const left = digits(stored);
  const right = digits(incoming);
  return left.length === 10 && left === right;
}

/** Statuses a late "sent" callback is still allowed to overwrite. */
export const SENT_OVERWRITABLE_STATUSES = ["queued", "sending"] as const;

/**
 * Delivery callbacks are not ordered. A "sent" arriving after "delivered" must
 * not walk the message back to looking like it is still in flight.
 */
export function deliveryStatusApplies(incoming: string, current: string): boolean {
  if (incoming !== "sent") return true;
  return (SENT_OVERWRITABLE_STATUSES as readonly string[]).includes(current);
}

/**
 * A short string that moves whenever what an open thread shows moves: a
 * message arriving, or one going from sent to delivered or failed.
 *
 * The page renders it, and while the thread is on screen it asks the server for
 * the current one and refreshes only when the two differ. That is how a reply
 * shows up without anybody reloading, without re-rendering the page every few
 * seconds while nothing has happened.
 *
 * Order does not count. The page and the check read the same rows with
 * separate queries, and two messages stamped the same instant can come back in
 * either order; that is not a change and must not look like one.
 */
export function threadFingerprint(messages: readonly { id: string; status: string }[]): string {
  return fingerprintOf(messages.map((message) => `${message.id}:${message.status}`));
}

/**
 * The same for the inbox: which threads are listed and when each last moved.
 * Every path that adds a message to a conversation stamps its last_message_at,
 * so this moves whenever a preview would change or a thread would jump to the
 * top.
 */
export function inboxFingerprint(
  conversations: readonly { id: string; lastMessageAt: string | null; status: string }[],
): string {
  return fingerprintOf(
    conversations.map(
      (conversation) =>
        `${conversation.id}:${conversation.lastMessageAt ?? ""}:${conversation.status}`,
    ),
  );
}

/**
 * FNV-1a over the sorted entries. Not a security measure: it only has to tell
 * two states of the same list apart, and it keeps a two-hundred-message thread
 * down to a few characters on every check.
 */
function fingerprintOf(entries: string[]): string {
  let hash = 0x811c9dc5;
  for (const entry of [...entries].sort()) {
    for (let index = 0; index < entry.length; index += 1) {
      hash = Math.imul(hash ^ entry.charCodeAt(index), 0x01000193);
    }
    // A separator, so ["ab", "c"] and ["a", "bc"] come out differently.
    hash = Math.imul(hash ^ 0x0a, 0x01000193);
  }
  return `${entries.length}.${(hash >>> 0).toString(36)}`;
}
