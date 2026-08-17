import test from "node:test";
import assert from "node:assert/strict";

import {
  buildBusinessHours,
  DAY_KEYS,
  defaultBusinessHours,
  parseBusinessHours,
} from "./business-hours.ts";

/** The value the column actually holds for the live business today. */
const STORED = {
  sunday: { enabled: false, start: "08:00", end: "17:00" },
  monday: { enabled: true, start: "08:00", end: "17:00" },
  tuesday: { enabled: true, start: "08:00", end: "17:00" },
  wednesday: { enabled: true, start: "08:00", end: "17:00" },
  thursday: { enabled: true, start: "08:00", end: "17:00" },
  friday: { enabled: true, start: "08:00", end: "17:00" },
  saturday: { enabled: false, start: "08:00", end: "17:00" },
};

test("the keys are the day names the SQL looks up", () => {
  // `list_public_booking_slots` does `business_hours -> lower(to_char(day, 'FMDay'))`.
  // An index, an abbreviation or a capital would find nothing, be read as
  // "closed", and take every slot off the booking page without an error.
  assert.deepEqual(DAY_KEYS, [
    "sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday",
  ]);
});

test("reads the open days out of what is stored", () => {
  assert.deepEqual(parseBusinessHours(STORED), [
    { weekday: 1, start: "08:00", end: "17:00" },
    { weekday: 2, start: "08:00", end: "17:00" },
    { weekday: 3, start: "08:00", end: "17:00" },
    { weekday: 4, start: "08:00", end: "17:00" },
    { weekday: 5, start: "08:00", end: "17:00" },
  ]);
});

test("what it writes is what it reads back", () => {
  // The round trip is the whole contract. Everything else in this file exists
  // to keep this true through a shape that Postgres does not validate.
  for (const pattern of [
    defaultBusinessHours(),
    [{ weekday: 3, start: "09:00", end: "16:00" }],
    [
      { weekday: 6, start: "09:00", end: "13:00" },
      { weekday: 0, start: "10:00", end: "14:00" },
    ],
    [],
  ]) {
    const sorted = [...pattern].sort((a, b) => a.weekday - b.weekday);
    assert.deepEqual(parseBusinessHours(buildBusinessHours(pattern)), sorted);
  }
});

test("a closed day keeps the times it had", () => {
  // Saturday off and on again must not quietly become 8–5.
  const previous = buildBusinessHours([{ weekday: 6, start: "09:00", end: "13:00" }]);
  const closed = buildBusinessHours([], previous);

  assert.equal(closed.saturday?.enabled, false);
  assert.equal(closed.saturday?.start, "09:00");
  assert.equal(closed.saturday?.end, "13:00");
});

test("every day is written, even the closed ones", () => {
  const built = buildBusinessHours([{ weekday: 1, start: "08:00", end: "17:00" }]);
  assert.deepEqual(Object.keys(built).sort(), [...DAY_KEYS].sort());
  assert.equal(built.monday?.enabled, true);
  assert.equal(built.sunday?.enabled, false);
});

test("junk in the column is a closed day, not a crash", () => {
  // Any organization member can write this column, and nothing but
  // `jsonb_typeof = 'object'` checks it. A page render must survive whatever is
  // in there rather than throw on somebody's whole Electricians screen.
  assert.deepEqual(parseBusinessHours(null), []);
  assert.deepEqual(parseBusinessHours("monday"), []);
  assert.deepEqual(parseBusinessHours([]), []);
  assert.deepEqual(parseBusinessHours({}), []);
  assert.deepEqual(parseBusinessHours({ monday: null }), []);
  assert.deepEqual(parseBusinessHours({ monday: { enabled: true } }), []);
  // A string, not a boolean — truthy in JavaScript and wrong here.
  assert.deepEqual(
    parseBusinessHours({ monday: { enabled: "true", start: "08:00", end: "17:00" } }),
    [],
  );
  // Backwards, and zero-length. Both would be a day the booking page offers
  // nothing on while claiming to be open.
  assert.deepEqual(
    parseBusinessHours({ monday: { enabled: true, start: "17:00", end: "08:00" } }),
    [],
  );
  assert.deepEqual(
    parseBusinessHours({ monday: { enabled: true, start: "08:00", end: "08:00" } }),
    [],
  );
});

test("times are normalised the way the form writes them", () => {
  // Postgres hands back "08:00:00" from a time column, and a hand-written row
  // can hold "8:00". Both are the same eight o'clock as the input's "08:00".
  assert.deepEqual(
    parseBusinessHours({ monday: { enabled: true, start: "8:00", end: "17:00:00" } }),
    [{ weekday: 1, start: "08:00", end: "17:00" }],
  );
});

test("the default is the weekday the column ships with", () => {
  assert.deepEqual(
    parseBusinessHours(buildBusinessHours(defaultBusinessHours())),
    parseBusinessHours(STORED),
  );
});
