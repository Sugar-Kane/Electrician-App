import test from "node:test";
import assert from "node:assert/strict";

import {
  formatDayLabel,
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
