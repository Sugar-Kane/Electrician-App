import test from "node:test";
import assert from "node:assert/strict";

import {
  calendarWeekStart,
  formatDayLabel,
  fullWeekOf,
  monthGridOf,
  monthLabel,
  monthStart,
  shiftMonths,
  isIsoDate,
  isoDateInZone,
  shiftDays,
  todayInZone,
  workWeekLabel,
  workWeekOf,
  workWeekStart,
} from "./calendar.ts";

test("today is the business's calendar day, not the server's", () => {
  // 2026-08-09 06:30 UTC is still the evening of the 8th in Ventura. A schedule
  // that jumps a day at 5pm local is worse than useless to a crew.
  const instant = new Date("2026-08-09T06:30:00Z");
  assert.equal(todayInZone("America/Los_Angeles", instant), "2026-08-08");
  assert.equal(todayInZone("America/New_York", instant), "2026-08-09");
  assert.equal(todayInZone("UTC", instant), "2026-08-09");
});

test("an unknown timezone falls back instead of throwing", () => {
  assert.equal(todayInZone("Mars/Olympus", new Date("2026-08-09T06:30:00Z")), "2026-08-09");
});

test("a date key is zero-padded", () => {
  assert.equal(isoDateInZone(new Date("2026-01-05T18:00:00Z"), "UTC"), "2026-01-05");
});

test("only real calendar dates are accepted from the query string", () => {
  assert.equal(isIsoDate("2026-08-03"), true);
  assert.equal(isIsoDate("2026-02-29"), false, "2026 is not a leap year");
  assert.equal(isIsoDate("2024-02-29"), true);
  assert.equal(isIsoDate("2026-13-01"), false);
  assert.equal(isIsoDate("2026-8-3"), false);
  assert.equal(isIsoDate("yesterday"), false);
  assert.equal(isIsoDate(""), false);
});

test("the work week runs Monday to Friday", () => {
  const week = workWeekOf("2026-08-05", "2026-08-05").map((day) => day.date);
  assert.deepEqual(week, [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
  ]);
});

test("the weekend looks ahead to the coming week", () => {
  // Saturday the 8th and Sunday the 9th both belong to the week starting the
  // 10th: nobody opens the schedule on Sunday to review the week that ended.
  assert.equal(workWeekStart("2026-08-08"), "2026-08-10");
  assert.equal(workWeekStart("2026-08-09"), "2026-08-10");
  assert.equal(workWeekStart("2026-08-10"), "2026-08-10");
  assert.equal(workWeekStart("2026-08-07"), "2026-08-03");
});

test("today is marked in the week it belongs to", () => {
  const week = workWeekOf("2026-08-05", "2026-08-05");
  assert.deepEqual(
    week.map((day) => day.isToday),
    [false, false, true, false, false],
  );
  assert.deepEqual(
    workWeekOf("2026-08-17", "2026-08-05").map((day) => day.isToday),
    [false, false, false, false, false],
  );
});

test("weekday and day-of-month labels come from the date itself", () => {
  const week = workWeekOf("2026-08-05", "2026-08-05");
  assert.deepEqual(
    week.map((day) => day.weekday),
    ["Mon", "Tue", "Wed", "Thu", "Fri"],
  );
  assert.deepEqual(
    week.map((day) => day.day),
    ["3", "4", "5", "6", "7"],
  );
});

test("day arithmetic survives a daylight-saving boundary", () => {
  // US clocks change on 2026-11-01. Adding a day at UTC midnight instead of
  // midday is how a schedule ends up repeating or skipping a Sunday.
  assert.equal(shiftDays("2026-10-31", 1), "2026-11-01");
  assert.equal(shiftDays("2026-11-01", 1), "2026-11-02");
  assert.equal(shiftDays("2026-03-08", -1), "2026-03-07");
  assert.equal(shiftDays("2026-08-03", 7), "2026-08-10");
  assert.equal(shiftDays("2026-01-01", -1), "2025-12-31");
});

test("the week heading spells out the range", () => {
  assert.equal(workWeekLabel(workWeekOf("2026-08-05", "")), "August 3–7, 2026");
});

test("a week that crosses a month names both months", () => {
  assert.equal(workWeekLabel(workWeekOf("2026-09-01", "")), "Aug 31 – Sep 4, 2026");
});

test("a week that crosses a year names both years", () => {
  assert.equal(
    workWeekLabel(workWeekOf("2025-12-30", "")),
    "Dec 29, 2025 – Jan 2, 2026",
  );
});

test("the selected day has a heading even when no jobs are booked", () => {
  assert.equal(formatDayLabel("2026-08-03"), "Mon, Aug 3");
  assert.equal(formatDayLabel("nonsense"), "");
});

test("a week view keeps a weekend in its own week", () => {
  // workWeekStart deliberately rolls a weekend forward, which is right for a
  // five-day picker and wrong here: somebody looking at Saturday's callout
  // wants the week Saturday is in, not the next one.
  assert.equal(calendarWeekStart("2026-08-08"), "2026-08-03"); // Saturday
  assert.equal(calendarWeekStart("2026-08-09"), "2026-08-03"); // Sunday
  assert.equal(calendarWeekStart("2026-08-03"), "2026-08-03"); // Monday itself
  assert.equal(calendarWeekStart("2026-08-05"), "2026-08-03");
});

test("a Sunday belongs to the week that began six days earlier", () => {
  // getUTCDay is 0 for Sunday. Treating that as "1 - 0 = tomorrow" would show
  // the wrong week for one day in seven.
  const week = fullWeekOf("2026-08-09", "2026-08-09");

  assert.equal(week.length, 7);
  assert.equal(week[0]!.date, "2026-08-03");
  assert.equal(week[6]!.date, "2026-08-09");
  assert.equal(week[6]!.isToday, true);
});

test("a week runs Monday to Sunday and marks today once", () => {
  const week = fullWeekOf("2026-08-05", "2026-08-05");

  assert.deepEqual(
    week.map((day) => day.weekday),
    ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
  );
  assert.equal(week.filter((day) => day.isToday).length, 1);
});

test("a month is always six whole weeks", () => {
  // A month that fits in five rows would make the page change height as you
  // page through the year, moving the buttons under somebody's thumb.
  for (const date of ["2026-02-01", "2026-08-15", "2027-01-31", "2024-02-29"]) {
    assert.equal(monthGridOf(date, "2026-08-11").length, 42, date);
  }
});

test("a month grid starts on a Monday and flags the padding days", () => {
  const grid = monthGridOf("2026-08-15", "2026-08-11");

  assert.equal(grid[0]!.weekday, "Mon");
  // August 2026 starts on a Saturday, so the grid opens in July.
  assert.equal(grid[0]!.inMonth, false);
  assert.equal(grid[0]!.date, "2026-07-27");

  const august = grid.filter((cell) => cell.inMonth);
  assert.equal(august.length, 31);
  assert.equal(august[0]!.date, "2026-08-01");
  assert.equal(august[30]!.date, "2026-08-31");
});

test("month arithmetic never skips a month", () => {
  // Naive arithmetic turns January 31st into March 3rd, so a "next month"
  // button silently jumps over February.
  assert.equal(shiftMonths("2026-01-31", 1), "2026-02-28");
  assert.equal(shiftMonths("2024-01-31", 1), "2024-02-29");
  assert.equal(shiftMonths("2026-03-31", -1), "2026-02-28");
  assert.equal(shiftMonths("2026-08-15", 1), "2026-09-15");
});

test("month arithmetic crosses a year boundary in both directions", () => {
  assert.equal(shiftMonths("2026-12-15", 1), "2027-01-15");
  assert.equal(shiftMonths("2026-01-15", -1), "2025-12-15");
  assert.equal(shiftMonths("2026-06-15", -18), "2024-12-15");
});

test("a month is named for a heading", () => {
  assert.equal(monthLabel("2026-08-15"), "August 2026");
  assert.equal(monthLabel("2026-01-01"), "January 2026");
  assert.equal(monthLabel("not-a-date"), "");
});

test("the first of the month is found from any day in it", () => {
  assert.equal(monthStart("2026-08-31"), "2026-08-01");
  assert.equal(monthStart("2026-02-14"), "2026-02-01");
});
