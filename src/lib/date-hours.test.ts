import test from "node:test";
import assert from "node:assert/strict";

import { hoursOn, isDated, upcoming, weekdayOfIso } from "./date-hours.ts";

/** Monday, Wednesday and Friday, eight until five. 2026-08-17 is a Monday. */
const MON_WED_FRI = [
  { weekday: 1, start: "08:00", end: "17:00" },
  { weekday: 3, start: "08:00", end: "17:00" },
  { weekday: 5, start: "08:00", end: "17:00" },
];

test("weekdays are read from the date, not from the machine", () => {
  assert.equal(weekdayOfIso("2026-08-17"), 1);
  assert.equal(weekdayOfIso("2026-08-22"), 6);
  assert.equal(weekdayOfIso("2026-08-23"), 0);
  assert.equal(weekdayOfIso("nonsense"), -1);
});

test("the usual week answers when nothing is dated", () => {
  assert.deepEqual(hoursOn("2026-08-17", MON_WED_FRI, []), {
    start: "08:00",
    end: "17:00",
    source: "week",
  });
  // Tuesday is not in the pattern.
  assert.equal(hoursOn("2026-08-18", MON_WED_FRI, []), null);
});

test("a dated row wins outright for its date", () => {
  // Next week is Tuesday and Thursday instead, so Tuesday gets hours it never
  // had and the Monday beside it is untouched.
  const dated = [{ date: "2026-08-25", start: "08:00", end: "17:00" }];

  assert.deepEqual(hoursOn("2026-08-25", MON_WED_FRI, dated), {
    start: "08:00",
    end: "17:00",
    source: "date",
  });
  assert.deepEqual(hoursOn("2026-08-24", MON_WED_FRI, dated), {
    start: "08:00",
    end: "17:00",
    source: "week",
  });
});

test("one Saturday from twelve until four", () => {
  const dated = [{ date: "2026-08-22", start: "12:00", end: "16:00" }];

  assert.deepEqual(hoursOn("2026-08-22", MON_WED_FRI, dated), {
    start: "12:00",
    end: "16:00",
    source: "date",
  });
  // The Saturday after it is an ordinary Saturday again.
  assert.equal(hoursOn("2026-08-29", MON_WED_FRI, dated), null);
});

test("a dated row replaces the day rather than adding to it", () => {
  // A Monday the pattern says is 8–5, cut to a short afternoon. The answer is
  // the afternoon, not both — a union here would sell the morning.
  const dated = [{ date: "2026-08-17", start: "13:00", end: "16:00" }];

  assert.deepEqual(hoursOn("2026-08-17", MON_WED_FRI, dated), {
    start: "13:00",
    end: "16:00",
    source: "date",
  });
});

test("no pattern at all is not the same as not working", () => {
  // Nobody has set hours, which everywhere else means "whenever the business is
  // open". Null lets the caller say that rather than claiming a day off.
  assert.equal(hoursOn("2026-08-17", [], []), null);
});

test("a date is marked as decided even when it matches the usual week", () => {
  const dated = [{ date: "2026-08-17", start: "08:00", end: "17:00" }];
  assert.equal(isDated("2026-08-17", dated), true);
  assert.equal(isDated("2026-08-18", dated), false);
  assert.equal(hoursOn("2026-08-17", MON_WED_FRI, dated)?.source, "date");
});

test("only the dates still ahead are worth listing", () => {
  const dated = [
    { date: "2026-08-30", start: "09:00", end: "12:00" },
    { date: "2026-08-10", start: "09:00", end: "12:00" },
    { date: "2026-08-17", start: "09:00", end: "12:00" },
    { date: "2026-08-22", start: "12:00", end: "16:00" },
  ];

  assert.deepEqual(
    upcoming(dated, "2026-08-17").map((entry) => entry.date),
    ["2026-08-17", "2026-08-22", "2026-08-30"],
  );
  assert.deepEqual(upcoming(dated, "2026-09-01"), []);
});
