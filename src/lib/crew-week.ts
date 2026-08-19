/**
 * Everybody's hours, day by day.
 *
 * Hours are set one person at a time — Nick on Monday and Tuesday, somebody
 * else on Wednesdays — and until now they could only be read back the same way.
 * This is the other direction: given a date, who can actually be booked and
 * between what times.
 *
 * "Actually" is the whole job. Five separate things decide it, and four of them
 * are invisible on the screen where the hours were typed:
 *
 *  - the business's hours, which cap everyone
 *  - a dated row, which answers for one date ahead of the weekly pattern
 *  - having no hours at all, which means available whenever the shop is open —
 *    not "never works", which is what a naive reading of `hoursOn` returning
 *    null would produce
 *  - time off, which takes days back
 *  - the working switch, which takes somebody out entirely
 *
 * Every one of those rules is `private.window_is_staffed` in SQL, and this file
 * exists so the calendar and the booking page cannot drift apart: an owner who
 * reads "Nick, 8am–3pm" here and finds no such slot on the booking page has
 * been lied to by one of the two.
 *
 * The one rule deliberately not modelled is the skills filter the booking SQL
 * also applies (`skills = '{}' or skills && general_service, diagnostics`).
 * Nothing in the app sets skills, so every row is empty and the filter is a
 * no-op; the day that changes, it belongs here.
 */

import { hoursOn, type DateHours } from "./date-hours.ts";
import type { DayHours } from "./electrician-hours.ts";
import { zonedWallClockToIso } from "./schedule-labels.ts";

/** A booked absence: an instant range, the way the database stores it. */
export type CrewTimeOff = {
  startsAt: string;
  endsAt: string;
  /** "Thursday" or "Aug 20–22", already phrased for a reader. */
  label: string;
};

export type CrewMember = {
  id: string;
  name: string;
  initials: string;
  /** The working switch. Off means never offered, whatever the hours say. */
  isActive: boolean;
  hours: DayHours[];
  dateHours: DateHours[];
  timeOff: CrewTimeOff[];
};

export type CrewBusiness = {
  hours: DayHours[];
  dated: DateHours[];
  /** Days the whole business is shut, which outrank every hour below them. */
  closures: CrewTimeOff[];
};

/** Why somebody cannot be booked on a day. */
export type CrewReason = "closed" | "roster" | "unscheduled" | "timeOff" | "outside";

export type CrewSlot = {
  id: string;
  name: string;
  initials: string;
  /** The hours a customer could actually book. Null when they cannot. */
  window: { start: string; end: string } | null;
  /** Their hours ran wider than the shop's, so this is the shop's. */
  trimmed: boolean;
  /** These hours came from a day set on its own, not from the usual week. */
  dated: boolean;
  /** Time off touching this day, whether or not it takes the whole of it. */
  timeOff: string;
  /** Null when there is a window. */
  reason: CrewReason | null;
};

export type CrewDay = {
  date: string;
  /** The shop's own hours for the date, or null when it is shut. */
  open: { start: string; end: string } | null;
  /** Named when a booked closure is what shut it, rather than the usual week. */
  closure: string;
  /** Everyone on the crew, working or not, in the order they were given. */
  slots: CrewSlot[];
  /** How many of them can be booked at all. */
  working: number;
};

/** The later of two "HH:MM"s. They sort as strings, which is why they are stored this way. */
function later(a: string, b: string): string {
  return a > b ? a : b;
}

function earlier(a: string, b: string): string {
  return a < b ? a : b;
}

/**
 * How a range of instants sits against a day's working window.
 *
 * The same comparison the booking SQL makes — `starts_at < window_end and
 * ends_at > window_start` — rather than a date-prefix match, which would call a
 * five-day holiday a single Monday and miss the other four.
 */
function overlap(
  range: CrewTimeOff,
  from: string,
  to: string,
): "none" | "part" | "all" {
  const starts = Date.parse(range.startsAt);
  const ends = Date.parse(range.endsAt);
  const windowStart = Date.parse(from);
  const windowEnd = Date.parse(to);

  if (Number.isNaN(starts) || Number.isNaN(ends)) return "none";
  if (Number.isNaN(windowStart) || Number.isNaN(windowEnd)) return "none";

  if (starts >= windowEnd || ends <= windowStart) return "none";
  return starts <= windowStart && ends >= windowEnd ? "all" : "part";
}

/** The instants a wall-clock window on a date corresponds to, where the business is. */
function instantsOf(iso: string, window: { start: string; end: string }, timeZone: string) {
  return {
    from: zonedWallClockToIso(`${iso}T${window.start}`, timeZone),
    to: zonedWallClockToIso(`${iso}T${window.end}`, timeZone),
  };
}

/** The first absence touching a window, and how much of it it takes. */
function absence(
  ranges: CrewTimeOff[],
  iso: string,
  window: { start: string; end: string },
  timeZone: string,
): { label: string; covers: "part" | "all" } | null {
  const { from, to } = instantsOf(iso, window, timeZone);
  if (!from || !to) return null;

  let partial: { label: string; covers: "part" } | null = null;

  for (const range of ranges) {
    const how = overlap(range, from, to);
    // A day taken off entirely is the answer; a morning off is only the answer
    // if nothing else takes the whole day, so the loop keeps looking.
    if (how === "all") return { label: range.label, covers: "all" };
    if (how === "part" && !partial) partial = { label: range.label, covers: "part" };
  }

  return partial;
}

/** Who can be booked on one date, and between what times. */
export function crewDay(
  iso: string,
  people: CrewMember[],
  business: CrewBusiness,
  timeZone: string,
): CrewDay {
  const hours = hoursOn(iso, business.hours, business.dated);

  // Closed is closed, and a booked closure outranks a dated row that opened the
  // day — the same precedence the booking function applies, so that opening one
  // Saturday cannot accidentally reopen Christmas.
  const shut = hours ? absence(business.closures, iso, hours, timeZone) : null;

  // Rebuilt rather than passed along: `hoursOn` answers with where it found the
  // hours, and that is this file's business, not its caller's.
  const open =
    hours && shut?.covers !== "all" ? { start: hours.start, end: hours.end } : null;

  const slots = people.map((person) => {
    const base: CrewSlot = {
      id: person.id,
      name: person.name,
      initials: person.initials,
      window: null,
      trimmed: false,
      dated: false,
      timeOff: "",
      reason: null,
    };

    if (!open) return { ...base, reason: "closed" as const };
    if (!person.isActive) return { ...base, reason: "roster" as const };

    const own = hoursOn(iso, person.hours, person.dateHours);

    // No hours set at all means available whenever the business is open, which
    // is what every row meant before per-person hours existed and what the
    // booking SQL still says in its `else true`. A pattern that exists but says
    // nothing about this weekday is the opposite: a day off.
    if (!own && person.hours.length > 0) return { ...base, reason: "unscheduled" as const };

    const wanted = own ?? { start: open.start, end: open.end, source: "week" as const };

    const start = later(wanted.start, open.start);
    const end = earlier(wanted.end, open.end);
    if (start >= end) return { ...base, reason: "outside" as const, dated: own?.source === "date" };

    const window = { start, end };
    const trimmed = start !== wanted.start || end !== wanted.end;
    const away = absence(person.timeOff, iso, window, timeZone);

    if (away?.covers === "all") {
      return { ...base, reason: "timeOff" as const, timeOff: away.label };
    }

    return {
      ...base,
      window,
      trimmed,
      dated: own?.source === "date",
      timeOff: away?.label ?? "",
    };
  });

  return {
    date: iso,
    open,
    closure: !open && shut ? shut.label : "",
    slots,
    working: slots.filter((slot) => slot.window !== null).length,
  };
}

/** The same, for a run of dates. */
export function crewWeek(
  dates: string[],
  people: CrewMember[],
  business: CrewBusiness,
  timeZone: string,
): CrewDay[] {
  return dates.map((iso) => crewDay(iso, people, business, timeZone));
}
