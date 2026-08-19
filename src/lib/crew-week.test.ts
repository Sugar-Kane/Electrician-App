import test from "node:test";
import assert from "node:assert/strict";

import { crewDay, crewWeek, type CrewBusiness, type CrewMember } from "./crew-week.ts";

const ZONE = "America/Los_Angeles";

// 24 August 2026 is a Monday, so the week below runs Monday to Sunday.
const MONDAY = "2026-08-24";
const WEDNESDAY = "2026-08-26";
const SATURDAY = "2026-08-29";
const SUNDAY = "2026-08-30";

/** Open Monday to Friday, eight until five — the shape a shop starts with. */
const OPEN: CrewBusiness = {
  hours: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: "08:00", end: "17:00" })),
  dated: [],
  closures: [],
};

function person(over: Partial<CrewMember> & { id: string }): CrewMember {
  return {
    name: over.id,
    initials: over.id.slice(0, 2).toUpperCase(),
    isActive: true,
    hours: [],
    dateHours: [],
    timeOff: [],
    ...over,
  };
}

const nick = person({
  id: "nick",
  hours: [
    { weekday: 1, start: "08:00", end: "15:00" },
    { weekday: 2, start: "08:00", end: "15:00" },
  ],
});

const sam = person({ id: "sam", hours: [{ weekday: 3, start: "12:00", end: "16:00" }] });

/** Nobody has typed any hours for them. */
const newcomer = person({ id: "newcomer" });

function slotFor(day: ReturnType<typeof crewDay>, id: string) {
  const found = day.slots.find((slot) => slot.id === id);
  assert.ok(found, `${id} is missing from ${day.date}`);
  return found;
}

test("each person's own days are their own", () => {
  // The question this whole screen exists to answer: Monday and Tuesday for
  // one person, Wednesdays for another, read back together.
  const monday = crewDay(MONDAY, [nick, sam, newcomer], OPEN, ZONE);
  assert.deepEqual(slotFor(monday, "nick").window, { start: "08:00", end: "15:00" });
  assert.equal(slotFor(monday, "sam").window, null);
  assert.equal(slotFor(monday, "sam").reason, "unscheduled");

  const wednesday = crewDay(WEDNESDAY, [nick, sam, newcomer], OPEN, ZONE);
  assert.equal(slotFor(wednesday, "nick").reason, "unscheduled");
  assert.deepEqual(slotFor(wednesday, "sam").window, { start: "12:00", end: "16:00" });
});

test("no hours at all means available whenever the shop is open", () => {
  // The rule that predates per-person hours and that the booking SQL still
  // states outright as `else true`. Read the other way — "no hours, never
  // works" — it would empty the booking page for a new hire.
  const monday = crewDay(MONDAY, [newcomer], OPEN, ZONE);
  const slot = slotFor(monday, "newcomer");
  assert.deepEqual(slot.window, { start: "08:00", end: "17:00" });
  // Following the shop is not the same as being cut back to it.
  assert.equal(slot.trimmed, false);
  assert.equal(slot.reason, null);
});

test("the shop's hours cap everybody, and the calendar says when they did", () => {
  const eager = person({ id: "eager", hours: [{ weekday: 1, start: "06:00", end: "20:00" }] });
  const slot = slotFor(crewDay(MONDAY, [eager], OPEN, ZONE), "eager");

  // 8–5 is what a customer can book, so 8–5 is what the calendar shows.
  assert.deepEqual(slot.window, { start: "08:00", end: "17:00" });
  assert.equal(slot.trimmed, true);
});

test("hours entirely outside the shop's are nobody's hours", () => {
  const evening = person({ id: "evening", hours: [{ weekday: 1, start: "18:00", end: "21:00" }] });
  const slot = slotFor(crewDay(MONDAY, [evening], OPEN, ZONE), "evening");

  assert.equal(slot.window, null);
  // Not "closed": the shop is open, their hours simply miss it, and saying so
  // is the difference between a puzzle and a fix.
  assert.equal(slot.reason, "outside");
});

test("a closed day closes everybody", () => {
  const sunday = crewDay(SUNDAY, [nick, sam, newcomer], OPEN, ZONE);
  assert.equal(sunday.open, null);
  assert.equal(sunday.working, 0);
  assert.deepEqual(
    sunday.slots.map((slot) => slot.reason),
    ["closed", "closed", "closed"],
  );
});

test("a day set on its own answers ahead of the usual week", () => {
  const saturdayWorker = person({
    ...nick,
    dateHours: [{ date: WEDNESDAY, start: "12:00", end: "16:00" }],
  });
  const slot = slotFor(crewDay(WEDNESDAY, [saturdayWorker], OPEN, ZONE), "nick");

  // The pattern says nothing about Wednesdays; the dated row still wins.
  assert.deepEqual(slot.window, { start: "12:00", end: "16:00" });
  assert.equal(slot.dated, true);
});

test("one Saturday, opened on purpose, is a working day for everybody it fits", () => {
  // The combination that pays for this file: the shop is shut on Saturdays, a
  // dated business row opens this one, and both a person with a dated row and a
  // person with no hours at all become bookable inside it.
  const business: CrewBusiness = {
    ...OPEN,
    dated: [{ date: SATURDAY, start: "12:00", end: "16:00" }],
  };
  const saturdayNick = person({
    ...nick,
    dateHours: [{ date: SATURDAY, start: "12:00", end: "16:00" }],
  });

  const saturday = crewDay(SATURDAY, [saturdayNick, sam, newcomer], business, ZONE);
  assert.deepEqual(saturday.open, { start: "12:00", end: "16:00" });
  assert.deepEqual(slotFor(saturday, "nick").window, { start: "12:00", end: "16:00" });
  assert.deepEqual(slotFor(saturday, "newcomer").window, { start: "12:00", end: "16:00" });
  // Sam's week says Wednesdays, and a Saturday the shop opened does not change
  // that for him.
  assert.equal(slotFor(saturday, "sam").reason, "unscheduled");
  assert.equal(saturday.working, 2);
});

test("a booked closure outranks a day somebody opened on purpose", () => {
  const business: CrewBusiness = {
    ...OPEN,
    dated: [{ date: SATURDAY, start: "12:00", end: "16:00" }],
    // Noon to four, Pacific, is 19:00–23:00 UTC.
    closures: [
      { startsAt: "2026-08-29T07:00:00Z", endsAt: "2026-08-30T07:00:00Z", label: "Labor Day" },
    ],
  };

  const saturday = crewDay(SATURDAY, [nick, newcomer], business, ZONE);
  assert.equal(saturday.open, null);
  assert.equal(saturday.closure, "Labor Day");
  assert.equal(saturday.working, 0);
});

test("the working switch takes somebody out whatever their hours say", () => {
  const off = person({ ...nick, id: "nick", isActive: false });
  const slot = slotFor(crewDay(MONDAY, [off], OPEN, ZONE), "nick");

  assert.equal(slot.window, null);
  assert.equal(slot.reason, "roster");
});

test("a day taken off is not a working day", () => {
  const away = person({
    ...nick,
    timeOff: [
      { startsAt: "2026-08-24T07:00:00Z", endsAt: "2026-08-25T07:00:00Z", label: "Monday" },
    ],
  });
  const slot = slotFor(crewDay(MONDAY, [away], OPEN, ZONE), "nick");

  assert.equal(slot.window, null);
  assert.equal(slot.reason, "timeOff");
  assert.equal(slot.timeOff, "Monday");
});

test("a morning off leaves the day standing, and says so", () => {
  // Eight until ten, Pacific. Splitting the day into two bookable windows is
  // not something the booking function does either, so this marks rather than
  // pretends.
  const away = person({
    ...nick,
    timeOff: [
      { startsAt: "2026-08-24T15:00:00Z", endsAt: "2026-08-24T17:00:00Z", label: "Dentist" },
    ],
  });
  const slot = slotFor(crewDay(MONDAY, [away], OPEN, ZONE), "nick");

  assert.deepEqual(slot.window, { start: "08:00", end: "15:00" });
  assert.equal(slot.reason, null);
  assert.equal(slot.timeOff, "Dentist");
});

test("time off on another day is not this day's business", () => {
  const away = person({
    ...nick,
    timeOff: [
      { startsAt: "2026-08-25T07:00:00Z", endsAt: "2026-08-26T07:00:00Z", label: "Tuesday" },
    ],
  });
  const slot = slotFor(crewDay(MONDAY, [away], OPEN, ZONE), "nick");

  assert.deepEqual(slot.window, { start: "08:00", end: "15:00" });
  assert.equal(slot.timeOff, "");
});

test("a week is the same answer seven times, in the order asked for", () => {
  const dates = [MONDAY, "2026-08-25", WEDNESDAY, "2026-08-27", "2026-08-28", SATURDAY, SUNDAY];
  const week = crewWeek(dates, [nick, sam, newcomer], OPEN, ZONE);

  assert.deepEqual(
    week.map((day) => day.date),
    dates,
  );
  assert.deepEqual(
    week.map((day) => day.working),
    // Mon: Nick + newcomer. Tue: the same. Wed: Sam + newcomer. Thu, Fri:
    // newcomer alone. Weekend: the shop is shut.
    [2, 2, 2, 1, 1, 0, 0],
  );
});
