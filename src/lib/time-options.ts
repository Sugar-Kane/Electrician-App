/**
 * The times a picker offers, and the one somebody already has.
 *
 * A list of times looks like the most trivial thing in the world until the
 * saved value is not on it. Somebody's hours start at 08:20 — typed into the
 * native control this replaces, which allowed any minute of the day — and a
 * picker built from a clean quarter-hour loop simply does not contain it. The
 * options that snap it to 08:15 have changed the business's opening time
 * because somebody opened a menu and closed it again, and nothing on screen
 * said so.
 *
 * So the rule here is: the list is generated from the step, and then whatever
 * is actually stored is inserted into it if it is missing. The picker can only
 * offer tidy times; it can never quietly discard an untidy one.
 *
 * Import-free apart from the formatting the rest of the app already uses.
 */

import { friendlyTime } from "./electrician-hours.ts";

export type TimeOption = {
  /** "08:30" — what the form posts, and what the database stores. */
  value: string;
  /** "8:30am" — what a person reads. */
  label: string;
  /**
   * True when this entry only exists because it was already saved. The picker
   * marks it, so an odd time reads as somebody's deliberate choice rather than
   * an option the list forgot to line up.
   */
  offStep: boolean;
};

/** "08:30" from 510 minutes. */
function asClock(minutes: number): string {
  const hour = Math.floor(minutes / 60);
  const minute = minutes % 60;
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Minutes since midnight, or null if that is not a time. */
export function minutesOf(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})/.exec((value ?? "").trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return hour * 60 + minute;
}

/**
 * Every time of the day at `step` minutes, plus `current` if it is not one.
 *
 * `step` divides 1440 in every case this app uses (15, 30, 60). A step that
 * does not is not rejected — the loop simply stops before midnight, which is
 * the same list a caller asking for something odd would expect.
 */
export function timeOptions(step: number, current?: string): TimeOption[] {
  const size = Number.isFinite(step) && step > 0 ? Math.floor(step) : 30;

  const options: TimeOption[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += size) {
    const value = asClock(minutes);
    options.push({ value, label: friendlyTime(value), offStep: false });
  }

  const saved = minutesOf(current ?? "");
  if (saved === null || saved % size === 0) return options;

  // Inserted in its right place rather than appended, so the list stays
  // something you can scan down.
  const value = asClock(saved);
  const at = options.findIndex((option) => minutesOf(option.value)! > saved);
  const entry: TimeOption = { value, label: friendlyTime(value), offStep: true };

  if (at === -1) options.push(entry);
  else options.splice(at, 0, entry);

  return options;
}
