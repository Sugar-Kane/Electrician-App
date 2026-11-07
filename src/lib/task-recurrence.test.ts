import assert from "node:assert/strict";
import { test } from "node:test";

import { datesToMake, nextOccurrence, readRule, type RepeatRule } from "./task-recurrence.ts";
import { dueInstant } from "./task-rules.ts";

function rule(input: Record<string, unknown>, start: string): RepeatRule {
  const read = readRule(input, start);
  assert.ok(read.ok, !read.ok ? read.message : "");
  return read.rule;
}

function series(r: RepeatRule, start: string, n: number): string[] {
  const out = [start];
  while (out.length < n) {
    const next = nextOccurrence(r, start, out[out.length - 1]!, out.length);
    if (!next) break;
    out.push(next);
  }
  return out;
}

test("daily and every-N-days", () => {
  assert.deepEqual(series(rule({ freq: "daily" }, "2026-11-28"), "2026-11-28", 4), ["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01"]);
  assert.deepEqual(series(rule({ freq: "daily", interval: 3 }, "2026-11-28"), "2026-11-28", 3), ["2026-11-28", "2026-12-01", "2026-12-04"]);
});

test("weekly on chosen days, and every other week keeps to the same weeks", () => {
  const monThu = rule({ freq: "weekly", weekdays: [1, 4] }, "2026-11-09");
  assert.deepEqual(series(monThu, "2026-11-09", 4), ["2026-11-09", "2026-11-12", "2026-11-16", "2026-11-19"]);
  const alternate = rule({ freq: "weekly", interval: 2, weekdays: [1] }, "2026-11-09");
  assert.deepEqual(series(alternate, "2026-11-09", 3), ["2026-11-09", "2026-11-23", "2026-12-07"]);
});

test("monthly on the 31st falls on the last day of short months and goes back to the 31st", () => {
  const r = rule({ freq: "monthly", monthday: 31 }, "2027-01-31");
  assert.deepEqual(series(r, "2027-01-31", 5), ["2027-01-31", "2027-02-28", "2027-03-31", "2027-04-30", "2027-05-31"]);
  const leap = rule({ freq: "monthly", monthday: 29 }, "2028-01-29");
  assert.equal(series(leap, "2028-01-29", 2)[1], "2028-02-29");
});

test("a series ends on its date or after its count", () => {
  assert.deepEqual(series(rule({ freq: "daily", until: "2026-12-02" }, "2026-11-30"), "2026-11-30", 10), ["2026-11-30", "2026-12-01", "2026-12-02"]);
  assert.equal(series(rule({ freq: "weekly", count: 3 }, "2026-11-09"), "2026-11-09", 10).length, 3);
  assert.equal(readRule({ freq: "hourly" }, "2026-11-09").ok, false);
  assert.equal(readRule({ freq: "daily", count: 100000 }, "2026-11-09").ok, false);
  assert.equal(readRule({ freq: "daily", until: "2026-01-01" }, "2026-11-09").ok, false);
});

test("a recurring 9:00 task stays at 9:00 local time across daylight saving", () => {
  const dates = series(rule({ freq: "weekly" }, "2026-10-26"), "2026-10-26", 2);
  assert.deepEqual(dates, ["2026-10-26", "2026-11-02"]);
  assert.equal(dueInstant(dates[0]!, "09:00", "America/Los_Angeles"), "2026-10-26T16:00:00.000Z", "PDT");
  assert.equal(dueInstant(dates[1]!, "09:00", "America/Los_Angeles"), "2026-11-02T17:00:00.000Z", "PST, same wall clock");
});

test("occurrences are made a week ahead, never in the past, and a stalled series restarts from today", () => {
  const daily = rule({ freq: "daily" }, "2026-11-01");
  assert.deepEqual(datesToMake(daily, "2026-11-01", null, 0, "2026-11-01").length, 8, "today plus seven days ahead");
  const weekly = rule({ freq: "weekly" }, "2026-10-05");
  assert.deepEqual(datesToMake(weekly, "2026-10-05", "2026-10-05", 1, "2026-11-07"), ["2026-11-09"], "missed weeks are skipped, not back-filled");
  assert.deepEqual(datesToMake(weekly, "2026-10-05", "2026-11-09", 6, "2026-11-07"), [], "the next one already exists");
});
