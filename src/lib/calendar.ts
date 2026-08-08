/**
 * Dates for the schedule, resolved in the business's timezone.
 *
 * "Today" is a wall-clock question, not an instant: a job at 8pm Pacific is
 * still today for a Ventura electrician while the server that renders the page
 * has already rolled over to tomorrow in UTC. Every date here is a
 * `YYYY-MM-DD` key computed in an explicit timezone, so the schedule shows the
 * current week wherever it is rendered from.
 *
 * Import-free so it can be tested directly, like messaging-rules.
 */

const DAY_MS = 86_400_000;

export type CalendarDay = {
  /** `YYYY-MM-DD`, the key jobs are matched on. */
  date: string;
  /** "Mon" */
  weekday: string;
  /** "3" */
  day: string;
  isToday: boolean;
};

function parts(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options }).formatToParts(instant);
  } catch {
    // An unknown timezone must not take a page down; UTC is the honest fallback.
    return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", ...options }).formatToParts(instant);
  }
}

function part(instant: Date, timeZone: string, options: Intl.DateTimeFormatOptions, type: string) {
  return parts(instant, timeZone, options).find((piece) => piece.type === type)?.value ?? "";
}

/** The calendar date an instant falls on in a given timezone. */
export function isoDateInZone(instant: Date, timeZone: string): string {
  const formatted = parts(instant, timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const value = (type: string) => formatted.find((piece) => piece.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

/** Today's date in the business's timezone. */
export function todayInZone(timeZone: string, now: Date = new Date()): string {
  return isoDateInZone(now, timeZone);
}

/**
 * Whether a string is a real `YYYY-MM-DD` date.
 *
 * The schedule takes its date from the query string, so "2026-02-31" and
 * anything else a hand-edited URL can carry has to be rejected rather than
 * silently shifted into March.
 */
export function isIsoDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return Number.isFinite(parsed.getTime()) && toIso(parsed) === value;
}

function toIso(instant: Date): string {
  return instant.toISOString().slice(0, 10);
}

/**
 * Midday UTC for a date key.
 *
 * Arithmetic happens at noon so that adding days can never land on the wrong
 * side of a daylight-saving boundary.
 */
function atNoon(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

/** A date key moved by whole days. */
export function shiftDays(date: string, days: number): string {
  return toIso(new Date(atNoon(date).getTime() + days * DAY_MS));
}

/**
 * The Monday of the work week a date belongs to.
 *
 * Saturday and Sunday roll forward: someone opening the schedule at the weekend
 * is looking at the week ahead, not the one that just ended.
 */
export function workWeekStart(date: string): string {
  const instant = atNoon(date);
  const weekday = instant.getUTCDay();
  const shift = weekday === 0 ? 1 : weekday === 6 ? 2 : 1 - weekday;
  return shiftDays(date, shift);
}

/** Monday through Friday of the work week containing `date`. */
export function workWeekOf(date: string, today: string): CalendarDay[] {
  const monday = workWeekStart(date);
  return Array.from({ length: 5 }, (_unused, index) => {
    const iso = shiftDays(monday, index);
    const instant = atNoon(iso);
    return {
      date: iso,
      weekday: part(instant, "UTC", { weekday: "short" }, "weekday"),
      day: String(instant.getUTCDate()),
      isToday: iso === today,
    };
  });
}

/** "August 3–7, 2026", or "Aug 31 – Sep 4, 2026" when the week spans a month. */
export function workWeekLabel(days: CalendarDay[]): string {
  const first = days[0];
  const last = days[days.length - 1];
  if (!first || !last) return "";

  const start = atNoon(first.date);
  const end = atNoon(last.date);
  const month = (instant: Date, style: "long" | "short") =>
    part(instant, "UTC", { month: style }, "month");
  const year = (instant: Date) => part(instant, "UTC", { year: "numeric" }, "year");

  if (month(start, "long") === month(end, "long") && year(start) === year(end)) {
    return `${month(start, "long")} ${start.getUTCDate()}–${end.getUTCDate()}, ${year(end)}`;
  }
  if (year(start) === year(end)) {
    return `${month(start, "short")} ${start.getUTCDate()} – ${month(end, "short")} ${end.getUTCDate()}, ${year(end)}`;
  }
  return `${month(start, "short")} ${start.getUTCDate()}, ${year(start)} – ${month(end, "short")} ${end.getUTCDate()}, ${year(end)}`;
}

/** "Mon, Aug 3" — the heading over a single day's jobs. */
export function formatDayLabel(date: string): string {
  if (!isIsoDate(date)) return "";
  const instant = atNoon(date);
  const pieces = parts(instant, "UTC", { weekday: "short", month: "short", day: "numeric" });
  const value = (type: string) => pieces.find((piece) => piece.type === type)?.value ?? "";
  return `${value("weekday")}, ${value("month")} ${value("day")}`;
}
