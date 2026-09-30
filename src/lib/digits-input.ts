/**
 * The phone and ZIP boxes, as they are typed.
 *
 * Both used to take anything. A letter in a phone number made the save fail
 * with a message about reading it, after the whole form had been filled in, and
 * a ZIP box ten characters wide let "93444-1234" into a column the rest of the
 * app treats as five digits. Now whatever is not a digit never appears, the
 * same way the Cost box keeps only what a price can contain.
 *
 * Import-free, so it can be tested without a browser.
 */

/** A US number is ten digits, area code included. */
export const PHONE_DIGITS = 10;

/** The five-digit part of a ZIP code, which is all the columns hold. */
export const ZIP_DIGITS = 5;

/**
 * The digits of a phone number, as typed or pasted.
 *
 * A pasted "+1 (805) 555-0142" arrives with its country code; the leading 1
 * is dropped so the ten digits that remain are the number. Anything past ten
 * is cut off rather than kept as a number that cannot be dialled.
 */
export function keepPhoneDigits(value: string): string {
  let digits = (value ?? "").replace(/\D/g, "");
  if (digits.length > PHONE_DIGITS && digits.startsWith("1")) digits = digits.slice(1);
  return digits.slice(0, PHONE_DIGITS);
}

/** The first five digits, so a pasted ZIP+4 keeps the part that is the ZIP. */
export function keepZipDigits(value: string): string {
  return (value ?? "").replace(/\D/g, "").slice(0, ZIP_DIGITS);
}
