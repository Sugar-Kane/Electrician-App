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
  if (!consentIsActive(input.consent)) {
    return input.consent.optedOutAt
      ? "This customer replied STOP. They have to opt in again themselves before you can text them."
      : "This customer has not opted in to text messages. Ask them to opt in on the booking page.";
  }
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
