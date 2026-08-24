/**
 * Keeping a money box to money.
 *
 * The cost field used to take anything and hand it to the parser, which was
 * where a letter or a second decimal point turned into a refused save — and,
 * before this release, into a form that emptied itself. Filtering as it is
 * typed means the unreadable value never exists.
 *
 * Deliberately permissive about *shape* while strict about *characters*. It
 * does not reformat while somebody is mid-number: no thousands separators
 * appearing under the cursor, no "0." completing itself. A person typing 1280
 * should see 1280.
 *
 * Import-free, so it can be tested without a browser.
 */

/**
 * Everything that is not a digit or a decimal point, removed.
 *
 * The first decimal point survives and the rest do not, which is what makes a
 * repeated tap on the point key harmless rather than fatal.
 */
export function keepMoneyCharacters(value: string): string {
  const kept = (value ?? "").replace(/[^\d.]/g, "");

  const firstDot = kept.indexOf(".");
  if (firstDot === -1) return kept;

  const whole = kept.slice(0, firstDot);
  const rest = kept.slice(firstDot + 1).replace(/\./g, "");

  // Cents, and no further. A third decimal on a price is either a typo or a
  // rate, and neither belongs in a box labelled Cost.
  return `${whole}.${rest.slice(0, 2)}`;
}

/** The same, for a quantity: three decimals, because wire is sold by the foot. */
export function keepQuantityCharacters(value: string): string {
  const kept = (value ?? "").replace(/[^\d.]/g, "");

  const firstDot = kept.indexOf(".");
  if (firstDot === -1) return kept;

  const whole = kept.slice(0, firstDot);
  const rest = kept.slice(firstDot + 1).replace(/\./g, "");
  return `${whole}.${rest.slice(0, 3)}`;
}

/** "12.50" from 1250, for putting cents back in a box someone types in. */
export function centsToInput(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return "";
  return (cents / 100).toFixed(2);
}
