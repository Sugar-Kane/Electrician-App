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
 * Import-free apart from the state list, so it can be tested without a browser.
 */

import { isUsStateCode } from "./us-states.ts";

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

export type StreetAddress = { line1: string; city: string; state: string; postalCode: string };

/**
 * The street, city, state and ZIP of a saved address, corrected.
 *
 * All four or nothing, because the properties table holds all four, and the
 * same two rules the New job form applies: a state from the list and a
 * five-digit ZIP. A mistyped state is the one that matters most — Google
 * places the address in the state it is given, or refuses to place it at all.
 */
export function readStreetAddress(raw: {
  line1: unknown;
  city: unknown;
  state: unknown;
  postalCode: unknown;
}): { ok: true; value: StreetAddress } | { ok: false; error: string } {
  const tidy = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");
  const line1 = tidy(raw.line1);
  const city = tidy(raw.city);
  const state = tidy(raw.state).toUpperCase();
  const postalCode = tidy(raw.postalCode);

  if (!line1 || !city || !state || !postalCode) {
    return { ok: false, error: "An address needs street, city, state, and ZIP." };
  }
  if (!isUsStateCode(state)) return { ok: false, error: "Pick the state from the list." };
  if (!/^\d{5}$/.test(postalCode)) return { ok: false, error: "A ZIP code is five digits." };

  return { ok: true, value: { line1, city, state, postalCode } };
}
