import test from "node:test";
import assert from "node:assert/strict";

import {
  dateLabel,
  monthGrid,
  monthLabel,
  shiftMonth,
  weekdayOf,
} from "./electrician-calendar.ts";

test("every column is its own weekday, in every month", () => {
  // The guarantee the whole control rests on. Tapping a cell toggles the
  // weekday of its column, so a grid off by one sets Tuesday when somebody
  // taps Wednesday — and looks perfectly fine while doing it.
  for (const [year, month] of [
    [2026, 1], [2026, 2], [2026, 8], [2026, 11], [2024, 2], [2027, 5],
  ] as [number, number][]) {
    for (const week of monthGrid(year, month)) {
      week.forEach((cell, column) => {
        assert.equal(cell.weekday, column, `${year}-${month} ${cell.iso}`);
      });
    }
  }
});

test("every row has seven days", () => {
  for (const [year, month] of [[2026, 2], [2026, 8], [2027, 1]] as [number, number][]) {
    for (const week of monthGrid(year, month)) {
      assert.equal(week.length, 7, `${year}-${month}`);
    }
  }
});

test("a month starting on a Saturday gets a full first row", () => {
  // 1 August 2026 is a Saturday, so six padding days precede it.
  const weeks = monthGrid(2026, 8);
  const first = weeks[0]!;
  assert.equal(first.filter((cell) => !cell.inMonth).length, 6);
  assert.equal(first[6]?.day, 1);
  assert.equal(first[6]?.inMonth, true);
  assert.equal(first[0]?.iso, "2026-07-26");
});

test("a month starting on a Sunday needs no leading padding", () => {
  // 1 February 2026 is a Sunday.
  const first = monthGrid(2026, 2)[0]!;
  assert.equal(first[0]?.day, 1);
  assert.equal(first[0]?.inMonth, true);
});

test("February knows about leap years", () => {
  const leap = monthGrid(2024, 2).flat().filter((cell) => cell.inMonth);
  const common = monthGrid(2026, 2).flat().filter((cell) => cell.inMonth);
  assert.equal(leap.length, 29);
  assert.equal(common.length, 28);
  assert.equal(leap[28]?.iso, "2024-02-29");
});

test("the padding comes from the neighbouring months, across a year boundary", () => {
  const january = monthGrid(2026, 1);
  assert.match(january[0]![0]!.iso, /^2025-12-/);

  const december = monthGrid(2026, 12);
  const last = december[december.length - 1]!;
  assert.match(last[6]!.iso, /^2027-01-/);
});

test("dates are the same wherever the machine thinks it is", () => {
  // `new Date(y, m, d)` is local time, and on a machine behind UTC that is the
  // previous day — which would rotate every column by one.
  assert.equal(weekdayOf(2026, 8, 1), 6);
  assert.equal(weekdayOf(2026, 8, 16), 0);
  assert.equal(monthGrid(2026, 8).flat().find((cell) => cell.iso === "2026-08-16")?.weekday, 0);
});

test("months shift and the year wraps in both directions", () => {
  assert.deepEqual(shiftMonth(2026, 8, 1), { year: 2026, month: 9 });
  assert.deepEqual(shiftMonth(2026, 12, 1), { year: 2027, month: 1 });
  assert.deepEqual(shiftMonth(2026, 1, -1), { year: 2025, month: 12 });
  assert.deepEqual(shiftMonth(2026, 1, -13), { year: 2024, month: 12 });
  assert.deepEqual(shiftMonth(2026, 8, 0), { year: 2026, month: 8 });
});

test("months are named the way somebody reads them", () => {
  assert.equal(monthLabel(2026, 8), "August 2026");
  assert.equal(monthLabel(2026, 1), "January 2026");
  assert.equal(monthLabel(2026, 12), "December 2026");
});

test("a date is spoken without an ordinal", () => {
  // The label a screen reader reads. An ordinal rule is three exceptions and a
  // fourth for the teens, and the version that got shipped said "the 21th".
  assert.equal(dateLabel("2026-08-21"), "August 21");
  assert.equal(dateLabel("2026-08-01"), "August 1");
  assert.equal(dateLabel("2026-12-31"), "December 31");
  // Nonsense in, the input back out — never "undefined NaN" in somebody's ear.
  assert.equal(dateLabel(""), "");
  assert.equal(dateLabel("not-a-date"), "not-a-date");
});
