/**
 * Recurring tasks: the rule, and the dates it produces. Import-free, so every
 * calendar edge here is tested directly.
 *
 * A recurring task is a series (the template and this rule) and separate
 * occurrences, each an ordinary task with its own history. Completing one
 * never completes another.
 *
 * The rules:
 *   - Dates are calendar dates in the series' time zone. A time of day is kept
 *     as wall-clock time, so a 9:00 task stays at 9:00 across daylight saving.
 *   - Monthly on a day the month does not have (the 31st in April) falls on the
 *     month's last day, and the next month goes back to the asked day.
 *   - Every series ends: on a date, after a number of occurrences, or at the
 *     cap below. Nothing repeats forever unseen.
 */

export const REPEAT_FREQUENCIES = ["daily", "weekly", "monthly"] as const;
export type RepeatFrequency = (typeof REPEAT_FREQUENCIES)[number];

/** How far ahead an occurrence is made, so it shows in Upcoming before it is due. */
export const LOOKAHEAD_DAYS = 7;
/** Most occurrences one series may make in total, when no end was given. */
export const MAX_OCCURRENCES = 500;
export const MAX_INTERVAL = 99;

export type RepeatRule = {
  freq: RepeatFrequency;
  /** Every N days, weeks or months. */
  interval: number;
  /** Weekly only: days of the week, 0 = Sunday. Empty means the start date's weekday. */
  weekdays: number[];
  /** Monthly only: day of the month, 1-31. */
  monthday: number | null;
  /** Last date an occurrence may fall on, inclusive. */
  until: string | null;
  /** Total occurrences, counting the first. */
  count: number | null;
};

export type RuleResult = { ok: true; rule: RepeatRule } | { ok: false; message: string };

function isDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function toUtc(date: string): Date {
  return new Date(`${date}T12:00:00Z`);
}

function fromUtc(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDaysTo(date: string, days: number): string {
  const anchor = toUtc(date);
  anchor.setUTCDate(anchor.getUTCDate() + days);
  return fromUtc(anchor);
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

export function weekdayIndex(date: string): number {
  return toUtc(date).getUTCDay();
}

/**
 * Read a rule from what a person or ChatGPT sent. The first occurrence's date
 * fills in what a rule leaves out (the weekday for weekly, the day for monthly).
 */
export function readRule(input: unknown, startDate: string): RuleResult {
  if (typeof input !== "object" || input === null) return { ok: false, message: "Say how often it repeats." };
  const raw = input as Record<string, unknown>;
  const freq = typeof raw.freq === "string" ? raw.freq : "";
  if (!(REPEAT_FREQUENCIES as readonly string[]).includes(freq)) return { ok: false, message: "It can repeat daily, weekly or monthly." };
  if (!isDate(startDate)) return { ok: false, message: "A repeating task needs a first date." };

  const interval = raw.interval === undefined || raw.interval === null || raw.interval === "" ? 1 : Number(raw.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) return { ok: false, message: `Repeat every 1 to ${MAX_INTERVAL}.` };

  let weekdays: number[] = [];
  if (freq === "weekly") {
    const given = Array.isArray(raw.weekdays) ? raw.weekdays.map(Number) : [];
    if (given.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) return { ok: false, message: "Weekdays are 0 (Sunday) to 6 (Saturday)." };
    weekdays = [...new Set(given.length ? given : [weekdayIndex(startDate)])].sort();
  }

  let monthday: number | null = null;
  if (freq === "monthly") {
    monthday = raw.monthday === undefined || raw.monthday === null || raw.monthday === "" ? Number(startDate.slice(8, 10)) : Number(raw.monthday);
    if (!Number.isInteger(monthday) || monthday < 1 || monthday > 31) return { ok: false, message: "The day of the month is 1 to 31." };
  }

  const until = typeof raw.until === "string" && raw.until ? raw.until : null;
  if (until && !isDate(until)) return { ok: false, message: "An end date looks like 2027-03-31." };
  if (until && until < startDate) return { ok: false, message: "The end date is before the first one." };

  const count = raw.count === undefined || raw.count === null || raw.count === "" ? null : Number(raw.count);
  if (count !== null && (!Number.isInteger(count) || count < 1 || count > MAX_OCCURRENCES)) {
    return { ok: false, message: `Repeat 1 to ${MAX_OCCURRENCES} times.` };
  }

  return { ok: true, rule: { freq: freq as RepeatFrequency, interval, weekdays, monthday, until, count } };
}

/** The asked day of a month, or its last day when the month is shorter. */
export function monthlyDate(year: number, monthIndex: number, monthday: number): string {
  const normalizedYear = year + Math.floor(monthIndex / 12);
  const normalizedMonth = ((monthIndex % 12) + 12) % 12;
  const day = Math.min(monthday, daysInMonth(normalizedYear, normalizedMonth));
  return `${normalizedYear}-${String(normalizedMonth + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The date of the occurrence after `previous`, counting from the series'
 * first date `start`, or null when the series has ended. `made` is how many
 * occurrences exist so far, counting the first.
 */
export function nextOccurrence(rule: RepeatRule, start: string, previous: string, made: number): string | null {
  const limit = rule.count ?? MAX_OCCURRENCES;
  if (made >= limit) return null;
  let next: string | null = null;

  if (rule.freq === "daily") {
    next = addDaysTo(previous, rule.interval);
  } else if (rule.freq === "weekly") {
    // Weeks are counted from the week of the first date (Sunday-based), so
    // "every 2 weeks on Mon and Thu" keeps to the same alternate weeks.
    const weekStart = (date: string) => addDaysTo(date, -weekdayIndex(date));
    const firstWeek = weekStart(start);
    for (let offset = 1; offset <= 7 * rule.interval * 2 + 7; offset += 1) {
      const candidate = addDaysTo(previous, offset);
      const weeksFromStart = Math.round((toUtc(weekStart(candidate)).getTime() - toUtc(firstWeek).getTime()) / (7 * 86_400_000));
      if (weeksFromStart % rule.interval === 0 && rule.weekdays.includes(weekdayIndex(candidate))) {
        next = candidate;
        break;
      }
    }
  } else {
    // Counted from the first date's month, so a series on the 31st does not
    // drift to the 30th after it passes through a short month.
    const first = toUtc(start);
    const prior = toUtc(previous);
    const monthsSince = (prior.getUTCFullYear() - first.getUTCFullYear()) * 12 + (prior.getUTCMonth() - first.getUTCMonth());
    const steps = Math.floor(monthsSince / rule.interval) + 1;
    next = monthlyDate(first.getUTCFullYear(), first.getUTCMonth() + steps * rule.interval, rule.monthday ?? first.getUTCDate());
  }

  if (!next || next <= previous) return null;
  if (rule.until && next > rule.until) return null;
  return next;
}

/** The occurrences a series is due to make now: next ones on or before today plus the lookahead, none in the past. */
export function datesToMake(
  rule: RepeatRule,
  start: string,
  lastMade: string | null,
  made: number,
  today: string,
): string[] {
  const horizon = addDaysTo(today, LOOKAHEAD_DAYS);
  const out: string[] = [];
  let previous = lastMade;
  let count = made;
  let candidate: string | null = lastMade ? nextOccurrence(rule, start, lastMade, count) : start;
  // At most a few per run: a series that fell behind while nobody looked starts
  // again from today, instead of filling the list with dates already gone.
  for (let guard = 0; candidate && guard < 5000 && out.length < 10; guard += 1) {
    if (candidate > horizon) break;
    if (candidate >= today) out.push(candidate);
    previous = candidate;
    count += 1;
    candidate = nextOccurrence(rule, start, previous, count);
  }
  return out;
}

/** "Every 2 weeks on Mon and Thu until Mar 31", for a person reading it. */
export function describeRule(rule: RepeatRule): string {
  const names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const unit = { daily: "day", weekly: "week", monthly: "month" }[rule.freq];
  let text = rule.interval === 1 ? `Every ${unit}` : `Every ${rule.interval} ${unit}s`;
  if (rule.freq === "weekly") text += ` on ${rule.weekdays.map((day) => names[day]).join(", ")}`;
  if (rule.freq === "monthly") text += ` on day ${rule.monthday} (or the month's last day)`;
  if (rule.until) text += `, until ${rule.until}`;
  if (rule.count) text += `, ${rule.count} times`;
  return text;
}
