/**
 * Which way the jobs page is reading the schedule.
 *
 * Its own module because both sides need it: the page reads the view out of the
 * URL on the server, and the board switches between views in the browser. A
 * `"use client"` module's exports cannot be called from the server at all — the
 * first version of this lived in the board and the page failed on the first
 * render with "attempted to call asScheduleView() from the server".
 *
 * Import-free, like `navigation.ts`, so the vocabulary can be tested without
 * rendering anything.
 */

export const SCHEDULE_VIEWS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  // The same week, read as who is working rather than what is booked. A tab
  // rather than a menu entry, because the menu lists destinations and this is a
  // view of one — the rule `navigation.test.ts` enforces.
  { value: "crew", label: "Crew" },
] as const;

export type ScheduleView = (typeof SCHEDULE_VIEWS)[number]["value"];

/**
 * A view name out of a query string.
 *
 * Anything unrecognised reads as the day, which is the view somebody standing
 * in a van wants: a URL somebody edited by hand should show them their day, not
 * an error.
 */
export function asScheduleView(value: string): ScheduleView {
  return SCHEDULE_VIEWS.some((view) => view.value === value) ? (value as ScheduleView) : "day";
}

/** The canonical link to a day in a view, for the URL and for the crew tab. */
export function scheduleHref(date: string, view: ScheduleView): string {
  return `/schedule?date=${date}&view=${view}`;
}

/**
 * How far an arrow moves.
 *
 * Day used to move seven days while the button said "Previous day" — so the
 * strip jumped a whole week and landed on the same weekday it started on, which
 * is why the highlight looked stuck to the Monday. Months are handled by the
 * caller, because a month is not a number of days.
 */
export function daysPerStep(view: ScheduleView): number {
  return view === "day" ? 1 : 7;
}
