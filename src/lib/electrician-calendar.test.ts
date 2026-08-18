import test from "node:test";
import assert from "node:assert/strict";

import {
  dateLabel,
  listDates,
  monthGrid,
  monthLabel,
  shiftMonth,
  shiftWeek,
  weekdayOf,
  weekGrid,
  weekLabel,
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

test("a week is seven days, and every column is its own weekday", () => {
  // The same guarantee monthGrid makes, and the same reason: the column is how
  // somebody reads which day they are tapping.
  for (const iso of ["2026-08-17", "2026-08-22", "2026-08-23", "2026-02-29", "2027-01-01"]) {
    const week = weekGrid(iso);
    assert.equal(week.length, 7, iso);
    week.forEach((cell, column) => {
      assert.equal(cell.weekday, column, `${iso} → ${cell.iso}`);
    });
  }
});

test("a week starts on the Sunday and contains the date asked for", () => {
  // 2026-08-17 is a Monday, so its week runs from Sunday the 16th.
  const week = weekGrid("2026-08-17");
  assert.equal(week[0]?.iso, "2026-08-16");
  assert.equal(week[6]?.iso, "2026-08-22");
  assert.ok(week.some((cell) => cell.iso === "2026-08-17"));

  // A Sunday is the start of its own week, not the end of the previous one.
  assert.equal(weekGrid("2026-08-16")[0]?.iso, "2026-08-16");
});

test("a week crossing a month keeps real dates on both sides", () => {
  const week = weekGrid("2026-09-02");
  assert.equal(week[0]?.iso, "2026-08-30");
  assert.equal(week[6]?.iso, "2026-09-05");
  // No padding in a week, so nothing is dimmed for being in the other month.
  assert.equal(week.every((cell) => cell.inMonth), true);
});

test("weeks shift in both directions and across a year", () => {
  assert.equal(shiftWeek("2026-08-17", 1), "2026-08-24");
  assert.equal(shiftWeek("2026-08-17", -1), "2026-08-10");
  assert.equal(shiftWeek("2026-08-17", 0), "2026-08-17");
  assert.equal(shiftWeek("2026-12-29", 1), "2027-01-05");
  assert.equal(shiftWeek("2027-01-05", -1), "2026-12-29");
  assert.equal(shiftWeek("nonsense", 1), "nonsense");
});

test("a week reads the way somebody says it", () => {
  assert.equal(weekLabel("2026-08-17"), "16–22 August");
  // Crossing a month has to name both, or "30–5 September" is a lie.
  assert.equal(weekLabel("2026-09-02"), "30 August – 5 September");
  // And crossing a year has to name both years.
  assert.equal(weekLabel("2026-12-31"), "27 December 2026 – 2 January 2027");
  assert.equal(weekLabel("nonsense"), "");
});

test("a handful of chosen days reads as a list", () => {
  assert.equal(listDates([]), "");
  assert.equal(listDates(["2026-08-25"]), "August 25");
  assert.equal(listDates(["2026-08-25", "2026-08-27", "2026-08-29"]), "25, 27 and 29 August");
  // Tapped in whatever order they were tapped in, read back in date order.
  assert.equal(listDates(["2026-08-29", "2026-08-25"]), "25 and 29 August");
});

test("a list crossing a month names both months", () => {
  // "29 and 2 August" would be a plain lie about the second date.
  assert.equal(listDates(["2026-08-29", "2026-09-02"]), "29 August and 2 September");
  assert.equal(
    listDates(["2026-12-30", "2027-01-02"]),
    "30 December and 2 January",
  );
});

test("a long list is capped rather than pushing the fields off the screen", () => {
  const nine = Array.from({ length: 9 }, (_, index) => `2026-08-0${index + 1}`);
  assert.equal(listDates(nine), "1, 2, 3, 4, 5, 6 August and 3 more");
  assert.equal(listDates(nine, 2), "1, 2 August and 7 more");
  // Exactly on the limit is a finished list, so it keeps its "and".
  assert.equal(listDates(nine.slice(0, 3), 3), "1, 2 and 3 August");
});

test("nonsense in a list is dropped, never rendered", () => {
  assert.equal(listDates(["not-a-date"]), "");
  assert.equal(listDates(["not-a-date", "2026-08-25"]), "August 25");
});

test("a week survives a leap day", () => {
  const week = weekGrid("2024-02-29");
  assert.equal(week.length, 7);
  assert.ok(week.some((cell) => cell.iso === "2024-02-29"));
  assert.equal(week[0]?.iso, "2024-02-25");
});
