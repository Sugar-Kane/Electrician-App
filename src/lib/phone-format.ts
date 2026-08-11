/**
 * Turning a number somebody typed into one a carrier will accept.
 *
 * Twilio is handed the `To` field verbatim, and it wants E.164 — so a booking
 * alert saved as "209-626-9313" is a text that silently never sends. The person
 * filling in the settings form is an electrician typing their own mobile the
 * way they would write it down, which is exactly the format that does not work.
 *
 * Deliberately narrow. This handles North American numbers, because that is
 * what the business serves and because guessing a country code for an
 * ambiguous string is worse than refusing it. Anything already in E.164 is
 * passed through untouched, so an international number entered correctly still
 * works.
 *
 * Import-free, so it can be tested without a provider.
 */

/** E.164: a plus, a country code, then up to fourteen more digits. */
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * The number as a carrier wants it, or empty when it cannot be made into one.
 *
 * Empty is a real answer, not a failure to be papered over: storing something
 * unsendable would turn "your alerts are configured" into a lie.
 */
export function toE164(input: string): string {
  const trimmed = (input ?? "").trim();
  if (!trimmed) return "";

  // Already correct, including any international number typed properly.
  if (E164.test(trimmed)) return trimmed;

  const hadPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";

  // A leading + means they told us the country code; believe them rather than
  // assuming North America.
  if (hadPlus) {
    const candidate = `+${digits}`;
    return E164.test(candidate) ? candidate : "";
  }

  // Ten digits is a North American number without its country code, which is
  // how almost everybody writes their own.
  if (digits.length === 10) return `+1${digits}`;

  // Eleven starting with 1 is the same number with the country code already on.
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;

  // Anything else is a typo, an extension, or a number from somewhere we
  // cannot infer. Refusing beats sending into the void.
  return "";
}

/** Whether this can be sent to at all. */
export function isSendablePhone(input: string): boolean {
  return toE164(input) !== "";
}

/**
 * A North American number written the way a person reads it.
 *
 * For showing back what was saved, so somebody who typed their mobile is not
 * confronted with `+12096269313` and left wondering whether it took.
 */
export function formatForDisplay(input: string): string {
  const normalized = toE164(input);
  if (!normalized.startsWith("+1") || normalized.length !== 12) return normalized || input;

  const digits = normalized.slice(2);
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}
