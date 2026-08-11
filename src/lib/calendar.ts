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

/**
 * The Monday of the week containing a date, weekends included.
 *
 * Different from `workWeekStart`, which rolls a weekend forward into the week
 * ahead. That is right for a five-day strip you are picking a working day from,
 * and wrong for a week view: somebody looking at Saturday's callout wants the
 * week that Saturday is in, not the next one.
 */
export function calendarWeekStart(date: string): string {
  const weekday = atNoon(date).getUTCDay();
  // getUTCDay is 0 for Sunday, which belongs to the week that began six days
  // earlier rather than the one starting tomorrow.
  return shiftDays(date, weekday === 0 ? -6 : 1 - weekday);
}

/** Monday through Sunday of the week containing `date`. */
export function fullWeekOf(date: string, today: string): CalendarDay[] {
  const monday = calendarWeekStart(date);
  return Array.from({ length: 7 }, (_unused, index) => {
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

export type MonthCell = CalendarDay & {
  /** False for the days either side that pad the grid out to whole weeks. */
  inMonth: boolean;
};

/** The first of the month a date belongs to. */
export function monthStart(date: string): string {
  return `${date.slice(0, 7)}-01`;
}

/**
 * A month as a grid of whole weeks, Monday first.
 *
 * Always six rows. A month that fits in five would otherwise make the page
 * change height as you page through the year, which moves the buttons under
 * somebody's thumb between taps.
 */
export function monthGridOf(date: string, today: string): MonthCell[] {
  const first = monthStart(date);
  const month = first.slice(0, 7);
  const gridStart = calendarWeekStart(first);

  return Array.from({ length: 42 }, (_unused, index) => {
    const iso = shiftDays(gridStart, index);
    const instant = atNoon(iso);
    return {
      date: iso,
      weekday: part(instant, "UTC", { weekday: "short" }, "weekday"),
      day: String(instant.getUTCDate()),
      isToday: iso === today,
      inMonth: iso.slice(0, 7) === month,
    };
  });
}

/** "August 2026" — the heading over a month grid. */
export function monthLabel(date: string): string {
  if (!isIsoDate(date)) return "";
  const instant = atNoon(date);
  const pieces = parts(instant, "UTC", { month: "long", year: "numeric" });
  const value = (type: string) => pieces.find((piece) => piece.type === type)?.value ?? "";
  return `${value("month")} ${value("year")}`;
}

/**
 * The same day one month away, without landing on a date that does not exist.
 *
 * Naive month arithmetic turns January 31st into March 3rd, which as a "next
 * month" button means a month gets skipped entirely.
 */
export function shiftMonths(date: string, months: number): string {
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const target = month - 1 + months;
  const targetYear = year + Math.floor(target / 12);
  const targetMonth = ((target % 12) + 12) % 12;

  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const day = Math.min(Number(date.slice(8, 10)), lastDay);

  const pad = (value: number) => String(value).padStart(2, "0");
  return `${targetYear}-${pad(targetMonth + 1)}-${pad(day)}`;
}

/** "Mon, Aug 3" — the heading over a single day's jobs. */
export function formatDayLabel(date: string): string {
  if (!isIsoDate(date)) return "";
  const instant = atNoon(date);
  const pieces = parts(instant, "UTC", { weekday: "short", month: "short", day: "numeric" });
  const value = (type: string) => pieces.find((piece) => piece.type === type)?.value ?? "";
  return `${value("weekday")}, ${value("month")} ${value("day")}`;
}
