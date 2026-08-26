import test from "node:test";
import assert from "node:assert/strict";

import {
  addDays,
  calendarDate,
  isoToZonedWallClock,
  nowLabel,
  relativeDay,
  slotLabel,
  zonedWallClockToIso,
} from "./schedule-labels.ts";

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

test("a time typed into the form means that time where the business is", () => {
  // 1pm Pacific in August is UTC-7, so 20:00Z. Read as UTC instead, the
  // customer would be told 6am.
  assert.equal(
    zonedWallClockToIso("2026-08-13T13:00", "America/Los_Angeles"),
    "2026-08-13T20:00:00.000Z",
  );
});

test("winter and summer differ by the hour daylight saving moves", () => {
  assert.equal(
    zonedWallClockToIso("2026-01-13T13:00", "America/Los_Angeles"),
    "2026-01-13T21:00:00.000Z",
  );
});

test("a zone that is ahead of UTC works the other way", () => {
  assert.equal(
    zonedWallClockToIso("2026-08-13T09:00", "Europe/London"),
    "2026-08-13T08:00:00.000Z",
  );
  assert.equal(
    zonedWallClockToIso("2026-08-13T09:00", "Asia/Tokyo"),
    "2026-08-13T00:00:00.000Z",
  );
});

test("an hour just after the clocks go forward is not thrown an hour out", () => {
  // 2026-03-08 is the US spring-forward: 01:59 PST is followed by 03:00 PDT.
  // 3am that morning is 10:00Z, an hour closer to UTC than the same clock time
  // the day before. The second probe pass exists for exactly this.
  assert.equal(
    zonedWallClockToIso("2026-03-08T03:00", "America/Los_Angeles"),
    "2026-03-08T10:00:00.000Z",
  );
  assert.equal(
    zonedWallClockToIso("2026-03-07T03:00", "America/Los_Angeles"),
    "2026-03-07T11:00:00.000Z",
  );
});

test("an hour that never happened resolves to a real instant, not a crash", () => {
  // 02:30 does not exist on the spring-forward morning. Somebody can still type
  // it, so it has to land somewhere sensible rather than throwing or becoming
  // the epoch — the surrounding hour is the honest answer.
  const iso = zonedWallClockToIso("2026-03-08T02:30", "America/Los_Angeles");
  assert.match(iso, /^2026-03-08T\d{2}:\d{2}:00\.000Z$/);
  assert.ok(!Number.isNaN(new Date(iso).getTime()));
});

test("garbage typed into the field does not become the epoch", () => {
  for (const value of ["", "tomorrow", "2026-08-13", "not-a-date", "13/08/2026"]) {
    assert.equal(zonedWallClockToIso(value, "America/Los_Angeles"), "", value);
  }
});

test("a stored instant comes back as the wall clock somebody typed", () => {
  // Round trip: what the form shows must be what the form would send back.
  const iso = zonedWallClockToIso("2026-08-13T13:00", "America/Los_Angeles");
  assert.equal(isoToZonedWallClock(iso, "America/Los_Angeles"), "2026-08-13T13:00");
});

test("midnight round trips rather than rendering as hour 24", () => {
  const iso = zonedWallClockToIso("2026-08-13T00:00", "America/Los_Angeles");
  assert.equal(isoToZonedWallClock(iso, "America/Los_Angeles"), "2026-08-13T00:00");
});

test("an unusable instant is shown as empty rather than as Invalid Date", () => {
  assert.equal(isoToZonedWallClock("", "America/Los_Angeles"), "");
  assert.equal(isoToZonedWallClock("not a date", "America/Los_Angeles"), "");
});

test("Arizona does not move, so summer and winter are the same offset", () => {
  // Phoenix is UTC-7 all year. A business there must not be shifted in summer
  // just because the rest of Mountain Time is.
  assert.equal(
    zonedWallClockToIso("2026-01-13T13:00", "America/Phoenix"),
    "2026-01-13T20:00:00.000Z",
  );
  assert.equal(
    zonedWallClockToIso("2026-08-13T13:00", "America/Phoenix"),
    "2026-08-13T20:00:00.000Z",
  );
});

test("Hawaii does not move either", () => {
  assert.equal(
    zonedWallClockToIso("2026-01-13T13:00", "Pacific/Honolulu"),
    "2026-01-13T23:00:00.000Z",
  );
  assert.equal(
    zonedWallClockToIso("2026-08-13T13:00", "Pacific/Honolulu"),
    "2026-08-13T23:00:00.000Z",
  );
});

test("Denver does move, which is what makes Phoenix worth testing", () => {
  // Same nominal Mountain Time, one hour apart for most of the year. Getting
  // this wrong sends an Arizona customer an appointment an hour out.
  const denverSummer = zonedWallClockToIso("2026-08-13T13:00", "America/Denver");
  const phoenixSummer = zonedWallClockToIso("2026-08-13T13:00", "America/Phoenix");
  assert.notEqual(denverSummer, phoenixSummer);

  const denverWinter = zonedWallClockToIso("2026-01-13T13:00", "America/Denver");
  const phoenixWinter = zonedWallClockToIso("2026-01-13T13:00", "America/Phoenix");
  assert.equal(denverWinter, phoenixWinter);
});

test("every timezone the app offers round trips in both halves of the year", () => {
  for (const zone of [
    "America/Los_Angeles",
    "America/Denver",
    "America/Phoenix",
    "America/Chicago",
    "America/New_York",
    "America/Anchorage",
    "Pacific/Honolulu",
    "America/Puerto_Rico",
  ]) {
    for (const wall of ["2026-01-13T13:00", "2026-08-13T13:00", "2026-11-01T09:00"]) {
      const iso = zonedWallClockToIso(wall, zone);
      assert.equal(isoToZonedWallClock(iso, zone), wall, `${zone} ${wall}`);
    }
  }
});

test("the hour that happens twice when the clocks go back resolves to one of them", () => {
  // 2026-11-01, 01:30 Pacific occurs twice. Either instant is defensible; what
  // matters is that it is a real instant and reads back as the same wall clock.
  const iso = zonedWallClockToIso("2026-11-01T01:30", "America/Los_Angeles");
  assert.ok(!Number.isNaN(new Date(iso).getTime()));
  assert.equal(isoToZonedWallClock(iso, "America/Los_Angeles"), "2026-11-01T01:30");
});

test("a day that is 23 hours long is still one calendar day", () => {
  // Spring forward: midnight to midnight is 23 hours, and the dashboard's
  // "today" window is built from exactly this pair.
  const start = new Date(zonedWallClockToIso("2026-03-08T00:00", "America/Los_Angeles"));
  const end = new Date(zonedWallClockToIso("2026-03-09T00:00", "America/Los_Angeles"));
  assert.equal((end.getTime() - start.getTime()) / 3_600_000, 23);
});

test("a day that is 25 hours long is also one calendar day", () => {
  const start = new Date(zonedWallClockToIso("2026-11-01T00:00", "America/Los_Angeles"));
  const end = new Date(zonedWallClockToIso("2026-11-02T00:00", "America/Los_Angeles"));
  assert.equal((end.getTime() - start.getTime()) / 3_600_000, 25);
});

test("an Arizona day is always 24 hours, including the weekends everyone else moves", () => {
  for (const [from, to] of [
    ["2026-03-08", "2026-03-09"],
    ["2026-11-01", "2026-11-02"],
  ]) {
    const start = new Date(zonedWallClockToIso(`${from}T00:00`, "America/Phoenix"));
    const end = new Date(zonedWallClockToIso(`${to}T00:00`, "America/Phoenix"));
    assert.equal((end.getTime() - start.getTime()) / 3_600_000, 24, from);
  }
});

test("a locale changes the wording and nothing else", () => {
  const start = "2026-08-27T15:00:00.000Z";
  const end = "2026-08-27T17:00:00.000Z";
  const now = "2026-08-26T20:00:00.000Z";
  const zone = "America/Los_Angeles";

  // Every existing call site omits the locale, and every one of them is a
  // screen the electrician reads. Defaulting is the whole reason this was safe
  // to add rather than thread through forty places.
  assert.equal(slotLabel(start, end, zone, now), slotLabel(start, end, zone, now, "en-US"));
  assert.match(slotLabel(start, end, zone, now), /^Tomorrow \(Thu, Aug 27\)/);

  // "Tomorrow" and "Thu" are the words that give away a machine when they land
  // in the middle of a Spanish sentence.
  const spanish = slotLabel(start, end, zone, now, "es-US");
  assert.match(spanish, /^Mañana \(jue, 27 de ago\)/);
  assert.doesNotMatch(spanish, /Tomorrow|Thu|AM/);

  // Same instant either way. A translated label that moved the time would be
  // the worst possible outcome here.
  assert.match(slotLabel(start, end, zone, now), /8:00 AM-10:00 AM/);
  assert.match(spanish, /8:00 a\.m\.-10:00 a\.m\./);
});

test("a locale nobody translated still says which day it is", () => {
  // The relative day is the part a customer reasons with. Losing it to a
  // missing translation would be worse than showing it in English.
  const label = slotLabel(
    "2026-08-27T15:00:00.000Z",
    "2026-08-27T17:00:00.000Z",
    "America/Los_Angeles",
    "2026-08-26T20:00:00.000Z",
    "pt-BR",
  );
  assert.match(label, /^Tomorrow \(/);
});
