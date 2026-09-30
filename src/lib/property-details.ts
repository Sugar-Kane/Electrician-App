/**
 * What a street address does not say: which door, and how to get to it.
 *
 * An apartment, suite or floor goes in `address_line_2`, and everything
 * somebody needs before they knock (the gate code, the dog, where the panel is,
 * where to park) goes in `access_notes`. Both belong to the property rather
 * than the job, because they are still true next time: every job at that
 * address shows them.
 *
 * The public booking form already collected both. These are the same two
 * columns, written from the business's side.
 *
 * Import-free, so it can be tested without a browser.
 */

/** The same limit the public booking form puts on the same column. */
export const MAX_UNIT_LENGTH = 120;

/**
 * Longer than the booking form's 500. Notes written by the business build up
 * visit by visit: the gate code, then the dog, then where the panel turned out
 * to be.
 */
export const MAX_ACCESS_NOTES_LENGTH = 1000;

/** "Apt 4B", on one line, with the spacing tidied. */
export function readUnit(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.trim().replace(/\s+/g, " ").slice(0, MAX_UNIT_LENGTH);
}

/**
 * The notes as written, line breaks and all, since a list of three things is
 * easier to read at a gate as three lines.
 */
export function readAccessNotes(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/\r\n?/g, "\n").trim().slice(0, MAX_ACCESS_NOTES_LENGTH);
}

/** "12 Oak Ave, Apt 4B", or just the street when there is no unit. */
export function streetWithUnit(street: string, unit: string): string {
  const tidyStreet = (street ?? "").trim();
  const tidyUnit = (unit ?? "").trim();
  if (!tidyUnit) return tidyStreet;
  if (!tidyStreet) return tidyUnit;
  return `${tidyStreet}, ${tidyUnit}`;
}
