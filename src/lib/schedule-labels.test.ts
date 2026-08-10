import test from "node:test";
import assert from "node:assert/strict";

import { addDays, calendarDate, nowLabel, relativeDay, slotLabel } from "./schedule-labels.ts";

const PACIFIC = "America/Los_Angeles";

test("the business's date is not the server's date", () => {
  // 01:28 UTC on the 10th is still the evening of the 9th in California. A
  // scheduler that asks from the UTC date drops the rest of the working day.
  assert.equal(calendarDate("2026-08-10T01:28:00.000Z", PACIFIC), "2026-08-09");
  assert.equal(calendarDate("2026-08-10T01:28:00.000Z", "UTC"), "2026-08-10");
});

test("a slot tomorrow morning is called tomorrow, not a bare date", () => {
  // The failure this exists for: "10 AM" on a Sunday evening, with no way for
  // the caller or the model to tell which day that is.
  const label = slotLabel(
    "2026-08-10T17:00:00+00:00",
    "2026-08-10T19:00:00+00:00",
    PACIFIC,
    "2026-08-10T01:28:00.000Z",
  );

  assert.match(label, /^Tomorrow /);
  assert.match(label, /Mon, Aug 10/);
  assert.match(label, /10:00 AM-12:00 PM/);
});

test("a slot later the same day is called today", () => {
  const label = slotLabel(
    "2026-08-10T22:00:00+00:00",
    "2026-08-11T00:00:00+00:00",
    PACIFIC,
    "2026-08-10T16:00:00.000Z",
  );
  assert.match(label, /^Today /);
});

test("anything further out is left as a date, because 'in three days' is worse", () => {
  const label = slotLabel(
    "2026-08-14T17:00:00+00:00",
    "2026-08-14T19:00:00+00:00",
    PACIFIC,
    "2026-08-10T01:28:00.000Z",
  );
  assert.doesNotMatch(label, /Today|Tomorrow/);
  assert.match(label, /Fri, Aug 14/);
});

test("with no clock the label is still correct, just not relative", () => {
  const label = slotLabel("2026-08-10T17:00:00+00:00", "2026-08-10T19:00:00+00:00", PACIFIC);
  assert.equal(label, "Mon, Aug 10, 10:00 AM-12:00 PM");
});

test("crossing a month, a year, and a daylight-saving change", () => {
  assert.equal(addDays("2026-08-31", 1), "2026-09-01");
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  // The Sunday PDT ends in 2026. Adding a day must not land back on the 1st.
  assert.equal(addDays("2026-11-01", 1), "2026-11-02");
  assert.equal(
    relativeDay("2026-11-02T18:00:00.000Z", "2026-11-01T18:00:00.000Z", PACIFIC),
    "tomorrow",
  );
});

test("the clock is stated in words a person would use", () => {
  const label = nowLabel("2026-08-10T01:28:00.000Z", PACIFIC);
  assert.match(label, /Sunday/);
  assert.match(label, /August 9/);
  assert.match(label, /6:28/);
});
