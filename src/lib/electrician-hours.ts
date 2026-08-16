/**
 * The week, and the times somebody types into it.
 *
 * Import-free so the parsing can be tested without a database. It is the part
 * most worth testing: a time that reads as valid but means something else — "9"
 * for nine in the morning, "17:00" against an end of "09:00" — becomes an
 * electrician the booking page silently never offers, and nobody finds out
 * until a customer says they could not get an appointment.
 */

export type Weekday = { value: number; label: string; short: string };

/** Sunday first, which is what `getDay()` and Postgres `dow` both mean by 0. */
export const WEEKDAYS: Weekday[] = [
  { value: 0, label: "Sunday", short: "Sun" },
  { value: 1, label: "Monday", short: "Mon" },
  { value: 2, label: "Tuesday", short: "Tue" },
  { value: 3, label: "Wednesday", short: "Wed" },
  { value: 4, label: "Thursday", short: "Thu" },
  { value: 5, label: "Friday", short: "Fri" },
  { value: 6, label: "Saturday", short: "Sat" },
];

/** What a working day looks like before anybody has said otherwise. */
export const DEFAULT_START = "08:00";
export const DEFAULT_END = "17:00";

export type HourRange =
  | { ok: true; start: string; end: string }
  | { ok: false; error: string };

/** "9:5" and "09:05" are the same time; "25:00" is not a time at all. */
function normalise(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec((value ?? "").trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseHourRange(start: string, end: string): HourRange {
  const from = normalise(start);
  const to = normalise(end);

  if (!from || !to) return { ok: false, error: "use a time like 08:00." };
  // Equal is rejected along with backwards. A day that starts and ends at nine
  // is zero hours long, which is a day off written the hard way.
  if (to <= from) return { ok: false, error: "the finish has to be after the start." };

  return { ok: true, start: from, end: to };
}

/** "8:00am", from the 24-hour value the form holds. */
export function friendlyTime(value: string): string {
  const normalised = normalise(value);
  if (!normalised) return value;

  const [hourText = "0", minute = "00"] = normalised.split(":");
  const hour = Number(hourText);
  const suffix = hour < 12 ? "am" : "pm";
  const shown = hour % 12 === 0 ? 12 : hour % 12;

  return minute === "00" ? `${shown}${suffix}` : `${shown}:${minute}${suffix}`;
}

export type DayHours = { weekday: number; start: string; end: string };

/**
 * How a week reads on one line: "Mon–Fri, 8am–5pm".
 *
 * Consecutive days on identical hours are collapsed into a range, because the
 * common case is five identical days and listing them is five times the width
 * on a phone for the same information.
 */
export function describeWeek(hours: DayHours[]): string {
  if (hours.length === 0) return "Whenever the business is open";

  const sorted = [...hours].sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start));
  const groups: { days: number[]; start: string; end: string }[] = [];

  for (const entry of sorted) {
    const last = groups[groups.length - 1];
    const runs =
      last !== undefined &&
      last.start === entry.start &&
      last.end === entry.end &&
      last.days[last.days.length - 1] === entry.weekday - 1;

    if (runs) last.days.push(entry.weekday);
    else groups.push({ days: [entry.weekday], start: entry.start, end: entry.end });
  }

  return groups
    .map((group) => {
      const first = WEEKDAYS[group.days[0]!]?.short ?? "";
      const last = WEEKDAYS[group.days[group.days.length - 1]!]?.short ?? "";
      const days = group.days.length === 1 ? first : `${first}–${last}`;
      return `${days}, ${friendlyTime(group.start)}–${friendlyTime(group.end)}`;
    })
    .join(" · ");
}
