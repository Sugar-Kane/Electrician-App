import test from "node:test";
import assert from "node:assert/strict";

import { minutesOf, timeOptions } from "./time-options.ts";

test("a step divides the day into the number of times it should", () => {
  assert.equal(timeOptions(15).length, 96);
  assert.equal(timeOptions(30).length, 48);
  assert.equal(timeOptions(60).length, 24);
});

test("the day starts at midnight and stops before the next one", () => {
  const half = timeOptions(30);
  assert.equal(half[0]?.value, "00:00");
  assert.equal(half[half.length - 1]?.value, "23:30");
  assert.equal(
    half.some((option) => option.value === "24:00"),
    false,
  );
});

test("every value is a time the form can post", () => {
  for (const option of timeOptions(15)) {
    assert.match(option.value, /^([01]\d|2[0-3]):[0-5]\d$/, option.value);
  }
});

test("a saved time that is not on the step is kept, not rounded away", () => {
  // The failure this file exists to prevent. Somebody's hours start at 08:20,
  // typed into the native control this replaces, which allowed any minute. A
  // list generated from a clean loop does not contain it, and a picker that
  // snaps it to 08:15 has moved the business's opening time because a menu was
  // opened and closed again.
  const options = timeOptions(15, "08:20");
  const odd = options.find((option) => option.value === "08:20");

  assert.ok(odd, "the saved time is missing from the list");
  assert.equal(odd.offStep, true);
  assert.equal(options.length, 97);
});

test("the odd one out sits in its right place in the day", () => {
  const options = timeOptions(30, "08:20");
  const at = options.findIndex((option) => option.value === "08:20");

  assert.equal(options[at - 1]?.value, "08:00");
  assert.equal(options[at + 1]?.value, "08:30");
});

test("a saved time already on the step adds nothing", () => {
  assert.equal(timeOptions(15, "08:15").length, 96);
  assert.equal(timeOptions(30, "00:00").length, 48);
  // Nothing saved yet is the same as a tidy one.
  assert.equal(timeOptions(30, "").length, 48);
  assert.equal(timeOptions(30).length, 48);
});

test("a saved time after the last option still lands at the end", () => {
  const options = timeOptions(60, "23:45");
  assert.equal(options[options.length - 1]?.value, "23:45");
  assert.equal(options.length, 25);
});

test("labels read the way the rest of the app writes times", () => {
  const day = timeOptions(30);
  assert.equal(day.find((option) => option.value === "00:00")?.label, "12am");
  assert.equal(day.find((option) => option.value === "08:00")?.label, "8am");
  assert.equal(day.find((option) => option.value === "12:30")?.label, "12:30pm");
  assert.equal(day.find((option) => option.value === "17:00")?.label, "5pm");
});

test("nonsense in the saved value is ignored rather than inserted", () => {
  for (const junk of ["", "  ", "banana", "25:00", "08:99", "8"]) {
    assert.equal(timeOptions(30, junk).length, 48, junk);
  }
});

test("a step that makes no sense falls back rather than looping forever", () => {
  assert.equal(timeOptions(0).length, 48);
  assert.equal(timeOptions(-15).length, 48);
  assert.equal(timeOptions(Number.NaN).length, 48);
});

test("minutes are counted from midnight", () => {
  assert.equal(minutesOf("00:00"), 0);
  assert.equal(minutesOf("08:30"), 510);
  assert.equal(minutesOf("23:59"), 1439);
  // Postgres hands back "08:30:00" from a time column.
  assert.equal(minutesOf("08:30:00"), 510);
  assert.equal(minutesOf("nope"), null);
  assert.equal(minutesOf("24:00"), null);
});
