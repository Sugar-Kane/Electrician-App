import test from "node:test";
import assert from "node:assert/strict";

import { describeWeek, friendlyTime, parseHourRange, WEEKDAYS } from "./electrician-hours.ts";

test("an ordinary working day is accepted and padded", () => {
  assert.deepEqual(parseHourRange("8:00", "17:00"), { ok: true, start: "08:00", end: "17:00" });
});

test("a finish before the start is refused", () => {
  const result = parseHourRange("17:00", "09:00");
  assert.equal(result.ok, false);
});

test("a day of zero length is refused too", () => {
  // The case a range check written as `<` would let through. Somebody who means
  // "not working" turns the day off; nine to nine is a mistake.
  const result = parseHourRange("09:00", "09:00");
  assert.equal(result.ok, false);
});

test("times that are not times are refused", () => {
  for (const bad of ["", "9", "0900", "25:00", "08:60", "eight", "08:00:00"]) {
    assert.equal(parseHourRange(bad, "17:00").ok, false, bad);
  }
});

test("midnight and one minute to it are both real times", () => {
  assert.deepEqual(parseHourRange("00:00", "23:59"), { ok: true, start: "00:00", end: "23:59" });
});

test("times read the way somebody says them", () => {
  assert.equal(friendlyTime("08:00"), "8am");
  assert.equal(friendlyTime("12:00"), "12pm");
  assert.equal(friendlyTime("00:00"), "12am");
  assert.equal(friendlyTime("13:30"), "1:30pm");
});

test("a five-day week collapses to one range", () => {
  const week = [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" }));
  assert.equal(describeWeek(week), "Mon–Fri, 8am–5pm");
});

test("a day on different hours is kept separate", () => {
  const week = [
    { weekday: 1, start: "08:00", end: "17:00" },
    { weekday: 2, start: "08:00", end: "17:00" },
    { weekday: 6, start: "09:00", end: "12:00" },
  ];
  assert.equal(describeWeek(week), "Mon–Tue, 8am–5pm · Sat, 9am–12pm");
});

test("a gap in the days breaks the range", () => {
  // Monday, Wednesday, Friday is three entries, not "Mon–Fri".
  const week = [1, 3, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" }));
  assert.equal(describeWeek(week), "Mon, 8am–5pm · Wed, 8am–5pm · Fri, 8am–5pm");
});

test("a split shift on one day reads as two", () => {
  const week = [
    { weekday: 2, start: "08:00", end: "12:00" },
    { weekday: 2, start: "13:00", end: "17:00" },
  ];
  assert.equal(describeWeek(week), "Tue, 8am–12pm · Tue, 1pm–5pm");
});

test("no hours at all means the business's own", () => {
  assert.equal(describeWeek([]), "Whenever the business is open");
});

test("the week starts on Sunday, as the database counts it", () => {
  // `extract(dow)` and `getDay()` both call Sunday 0. A week written Monday
  // first here would shift every saved day by one.
  assert.equal(WEEKDAYS[0]?.value, 0);
  assert.equal(WEEKDAYS[0]?.label, "Sunday");
  assert.equal(WEEKDAYS[6]?.label, "Saturday");
});
