/**
 * A month laid out as a calendar.
 *
 * Dates only — no times, no timezone, no daylight saving. The hours a person
 * works are a weekday and a pair of clock times; nothing here needs to know
 * what instant anything happened at, and pulling a timezone into this file
 * would be inventing a problem the data does not have.
 *
 * Import-free, because the interesting part is arithmetic that is wrong in ways
 * you cannot see by looking: a month that begins on a Saturday, a February that
 * is 29 days long, and above all the guarantee the whole control depends on —
 * that column *n* of every row is weekday *n*. Get that wrong by one and the
 * calendar sets Tuesday when somebody taps Wednesday, which looks completely
 * fine on screen.
 */

export type CalendarCell = {
  /** YYYY-MM-DD, and the key for anything dated. */
  iso: string;
  /** Day of the month, 1–31. */
  day: number;
  /** 0 = Sunday, matching WEEKDAYS and Postgres `date_part('dow')`. */
  weekday: number;
  /** False for the padding days from the neighbouring months. */
  inMonth: boolean;
};

/** Days in a month. Month is 1–12, which is how a human writes it. */
function daysInMonth(year: number, month: number): number {
  // Day 0 of the next month is the last day of this one, and it handles leap
  // years without a rule about centuries.
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function isoFor(year: number, month: number, day: number): string {
  return `${year.toString().padStart(4, "0")}-${month
    .toString()
    .padStart(2, "0")}-${day.toString().padStart(2, "0")}`;
}

/** The weekday a date falls on, 0–6 from Sunday. */
export function weekdayOf(year: number, month: number, day: number): number {
  // UTC throughout. `new Date(y, m, d)` is local, and on a machine running
  // behind UTC that is the previous day — which would rotate the entire grid.
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * The month as whole weeks, Sunday first.
 *
 * Padded at both ends with the neighbouring months' days so every row has seven
 * cells and the columns stay square. The padding is real dates rather than
 * blanks: a calendar with holes in the first row looks broken, and marking them
 * `inMonth: false` is enough for the component to grey them.
 */
export function monthGrid(year: number, month: number): CalendarCell[][] {
  const total = daysInMonth(year, month);
  const firstWeekday = weekdayOf(year, month, 1);

  const cells: CalendarCell[] = [];

  // Trailing days of the previous month, filling the first row.
  const previousMonth = month === 1 ? 12 : month - 1;
  const previousYear = month === 1 ? year - 1 : year;
  const previousTotal = daysInMonth(previousYear, previousMonth);

  for (let index = firstWeekday; index > 0; index -= 1) {
    const day = previousTotal - index + 1;
    cells.push({
      iso: isoFor(previousYear, previousMonth, day),
      day,
      weekday: weekdayOf(previousYear, previousMonth, day),
      inMonth: false,
    });
  }

  for (let day = 1; day <= total; day += 1) {
    cells.push({
      iso: isoFor(year, month, day),
      day,
      weekday: weekdayOf(year, month, day),
      inMonth: true,
    });
  }

  // Leading days of the next month, completing the last row.
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  for (let day = 1; cells.length % 7 !== 0; day += 1) {
    cells.push({
      iso: isoFor(nextYear, nextMonth, day),
      day,
      weekday: weekdayOf(nextYear, nextMonth, day),
      inMonth: false,
    });
  }

  const weeks: CalendarCell[][] = [];
  for (let index = 0; index < cells.length; index += 7) {
    weeks.push(cells.slice(index, index + 7));
  }

  return weeks;
}

/** The month `delta` months away, wrapping the year. */
export function shiftMonth(
  year: number,
  month: number,
  delta: number,
): { year: number; month: number } {
  // Counted in months since year zero so the wrap is arithmetic rather than a
  // pair of conditionals that only handle ±1.
  const absolute = year * 12 + (month - 1) + delta;
  return { year: Math.floor(absolute / 12), month: (absolute % 12) + 1 };
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** "August 2026". */
export function monthLabel(year: number, month: number): string {
  return `${MONTH_NAMES[month - 1] ?? ""} ${year}`;
}

/**
 * "August 21", from a YYYY-MM-DD.
 *
 * For labels a screen reader will speak, where the day alone is ambiguous once
 * a calendar can be paged. No ordinal: "21st" needs a rule with three
 * exceptions and a fourth for the teens, and getting it wrong reads as "the
 * 21th" — which is precisely what the first version of this said.
 */
export function dateLabel(iso: string): string {
  const [, month = "", day = ""] = iso.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  if (!name || !day) return iso;

  return `${name} ${Number(day)}`;
}

/** Today where the business is, as YYYY-MM-DD. */
export function todayIso(timeZone: string): string {
  // `en-CA` formats as YYYY-MM-DD, which saves parsing the parts back out of a
  // localised string.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
