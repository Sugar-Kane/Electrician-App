/**
 * Saying when something is, to someone who is standing in a particular day.
 *
 * "Mon, Aug 10, 10:00 AM" is unambiguous on paper and useless on a phone call.
 * A caller hearing it at six on Sunday evening cannot tell whether that is
 * tomorrow morning or a week away, and neither can a model that was never told
 * what today is — it will guess, and sooner or later it offers someone a time
 * that has already been and gone.
 *
 * So every label carries the day relative to now, and the business's clock is
 * stated outright rather than assumed. All of it is computed in the business's
 * timezone, never the server's: a scheduler that thinks in UTC hands out
 * tomorrow's slots from five in the afternoon.
 *
 * Import-free so the arithmetic can be tested at the hours it actually breaks.
 */

/** "2026-08-10" — the calendar date at that instant, where the business is. */
export function calendarDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

/** The calendar date `days` after the given one, as a plain date string. */
export function addDays(date: string, days: number): string {
  // Noon UTC, so a shift of a day cannot land on the wrong side of midnight.
  const anchor = new Date(`${date}T12:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return anchor.toISOString().slice(0, 10);
}

export type RelativeDay = "today" | "tomorrow" | "";

export function relativeDay(startIso: string, nowIso: string, timeZone: string): RelativeDay {
  const slotDate = calendarDate(startIso, timeZone);
  const nowDate = calendarDate(nowIso, timeZone);

  if (slotDate === nowDate) return "today";
  if (slotDate === addDays(nowDate, 1)) return "tomorrow";
  return "";
}

function timeOfDay(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

/**
 * "Tomorrow (Mon, Aug 10), 10:00 AM-12:00 PM".
 *
 * The relative day leads, because it is the part a caller actually reasons
 * with; the date follows so nothing is ambiguous when they write it down.
 */
export function slotLabel(
  start: string,
  end: string,
  timeZone: string,
  nowIso?: string,
): string {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(start));

  const window = `${timeOfDay(start, timeZone)}-${timeOfDay(end, timeZone)}`;
  const relative = nowIso ? relativeDay(start, nowIso, timeZone) : "";

  if (relative === "today") return `Today (${day}), ${window}`;
  if (relative === "tomorrow") return `Tomorrow (${day}), ${window}`;
  return `${day}, ${window}`;
}

/** "Sunday, August 9, 6:28 PM" — the business's clock, said plainly. */
export function nowLabel(nowIso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(nowIso));
}
