/**
 * Which hours apply on a particular day.
 *
 * There are two answers competing: the weekly pattern, which says what a
 * Wednesday is like in general, and a dated row, which says what *this*
 * Wednesday is like. The dated one wins, completely — not merged, not added to.
 * Somebody who sets one Saturday from twelve until four has said what that
 * Saturday is, and taking the union with a pattern that says nothing about
 * Saturdays would produce hours nobody asked for.
 *
 * The same function answers for an electrician and for the business, because
 * the question is the same shape at both scopes and the booking SQL resolves
 * them the same way. Keeping one implementation is the point: this file and
 * `private.window_is_staffed` have to agree, or the screen shows one thing and
 * the booking page sells another.
 *
 * Import-free apart from the weekday type the rest of the app already uses.
 */

import type { DayHours } from "./electrician-hours.ts";

/** Hours set for one specific date. */
export type DateHours = {
  /** YYYY-MM-DD. */
  date: string;
  start: string;
  end: string;
};

export type ResolvedDay = {
  start: string;
  end: string;
  /** Where the answer came from, so the calendar can mark the dated ones. */
  source: "date" | "week";
};

/** 0–6 from Sunday, for a YYYY-MM-DD. UTC, so the server's clock cannot rotate it. */
export function weekdayOfIso(iso: string): number {
  const at = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(at.getTime()) ? -1 : at.getUTCDay();
}

/**
 * The hours worked on `iso`, or null for a day that is not worked.
 *
 * `pattern` empty means "no hours set at all", which everywhere else in this app
 * means available whenever the business is open. That is not the same as "not
 * working", so it comes back as null here and the caller decides — the calendar
 * says so in words, and the booking SQL treats it as open.
 */
export function hoursOn(
  iso: string,
  pattern: DayHours[],
  dated: DateHours[],
): ResolvedDay | null {
  const override = dated.find((entry) => entry.date === iso);
  if (override) return { start: override.start, end: override.end, source: "date" };

  const weekday = weekdayOfIso(iso);
  const usual = pattern.find((entry) => entry.weekday === weekday);
  if (usual) return { start: usual.start, end: usual.end, source: "week" };

  return null;
}

/**
 * True when this date has been decided on its own, whatever the week says.
 *
 * Includes a dated row that happens to match the pattern exactly. It was still
 * set deliberately, and a mark that disappears when the times happen to agree
 * would be a mark you cannot trust.
 */
export function isDated(iso: string, dated: DateHours[]): boolean {
  return dated.some((entry) => entry.date === iso);
}

/**
 * Dated rows from today onwards, soonest first.
 *
 * Yesterday's one-off Saturday is history: it cannot be acted on and it pushes
 * the ones that can off the bottom of the list.
 */
export function upcoming(dated: DateHours[], todayIso: string): DateHours[] {
  return dated
    .filter((entry) => entry.date >= todayIso)
    .sort((a, b) => a.date.localeCompare(b.date));
}
