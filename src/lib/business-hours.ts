/**
 * The hours the business itself is open, as they are stored and as they are read.
 *
 * `service_settings.business_hours` is a JSONB object keyed by day name —
 * `{"monday": {"enabled": true, "start": "08:00", "end": "17:00"}, …}` — and the
 * only thing the database checks is that it is an object. Every other guarantee
 * is this file's job.
 *
 * The keys are not decorative. `list_public_booking_slots` looks a day up with
 * `lower(to_char(day_value, 'FMDay'))`, so "monday" is a contract with the SQL:
 * misspell it, or switch to an index, and the function finds nothing, takes
 * `day_config is null` as "closed", and the booking page quietly offers no
 * appointments at all. That is why the mapping is here, once, with a test.
 *
 * Import-free, so it can be tested without a database.
 */

import {
  DEFAULT_END,
  DEFAULT_START,
  WEEKDAYS,
  type DayHours,
} from "./electrician-hours.ts";

/** One day as the column stores it. */
export type BusinessDay = { enabled: boolean; start: string; end: string };

/** The whole column: seven day names, in the order Postgres writes them. */
export type BusinessHours = Record<string, BusinessDay>;

/** The key `to_char(day, 'FMDay')` produces, for each weekday number. */
export function dayKeyFor(weekday: number): string {
  return (WEEKDAYS[weekday]?.label ?? "").toLowerCase();
}

/** All seven keys, Sunday first to match `WEEKDAYS` and Postgres `dow`. */
export const DAY_KEYS: string[] = WEEKDAYS.map((day) => dayKeyFor(day.value));

/** "08:00" from "08:00", "8:00" or "08:00:00"; null from anything else. */
function readTime(value: unknown): string | null {
  if (typeof value !== "string") return null;

  const match = /^(\d{1,2}):(\d{2})/.exec(value.trim());
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * The stored object as the list of open days the calendar speaks.
 *
 * Deliberately forgiving. This runs on a page render, and the column has been
 * writable by any organization member since it was created — so a missing day, a
 * null start, or a `"true"` where a boolean belongs has to come back as "that
 * day is closed" rather than throw and take the whole Electricians page down.
 *
 * A day that is on but unreadable is dropped rather than defaulted to 8–5.
 * Guessing here would invent opening hours the owner never set.
 */
export function parseBusinessHours(value: unknown): DayHours[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [];

  const record = value as Record<string, unknown>;
  const open: DayHours[] = [];

  for (const day of WEEKDAYS) {
    const entry = record[dayKeyFor(day.value)];
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) continue;

    const config = entry as Record<string, unknown>;
    if (config.enabled !== true) continue;

    const start = readTime(config.start);
    const end = readTime(config.end);
    if (!start || !end || end <= start) continue;

    open.push({ weekday: day.value, start, end });
  }

  return open;
}

/**
 * The open days back into the stored object.
 *
 * Every one of the seven keys is written, because that is the shape onboarding
 * created and the shape `create_owner_workspace` validates — a partial object
 * would still work today, since the SQL treats a missing key as closed, but it
 * would be a second shape in the same column for no gain.
 *
 * Closed days keep whatever times they had. Switching Saturday off and on again
 * should not silently lose the 9-to-1 somebody set on it, and the times on a
 * closed day are inert anyway: the SQL stops at `enabled`.
 */
export function buildBusinessHours(open: DayHours[], previous?: unknown): BusinessHours {
  const wasOpen = new Map(
    parseBusinessHours(previous).map((day) => [day.weekday, day] as const),
  );
  const nowOpen = new Map(open.map((day) => [day.weekday, day] as const));

  const built: BusinessHours = {};

  for (const day of WEEKDAYS) {
    const entry = nowOpen.get(day.value);
    const remembered = wasOpen.get(day.value);

    built[dayKeyFor(day.value)] = {
      enabled: Boolean(entry),
      start: entry?.start ?? remembered?.start ?? DEFAULT_START,
      end: entry?.end ?? remembered?.end ?? DEFAULT_END,
    };
  }

  return built;
}

/** Mon–Fri, 8am–5pm: what the column defaults to for a business that never said. */
export function defaultBusinessHours(): DayHours[] {
  return [1, 2, 3, 4, 5].map((weekday) => ({
    weekday,
    start: DEFAULT_START,
    end: DEFAULT_END,
  }));
}
