import test from "node:test";
import assert from "node:assert/strict";

import { buildTimeline, moneyLabel, type ActivityRow } from "./activity-timeline.ts";

const ZONE = "America/Los_Angeles";
const TODAY = "2026-08-19";

function row(over: Partial<ActivityRow> & { id: string }): ActivityRow {
  return {
    eventType: "booking.requested",
    label: "written by whoever wrote it",
    createdAt: "2026-08-19T18:00:00Z",
    ...over,
  };
}

test("an event is read the way somebody says it, not the way it was stored", () => {
  const [day] = buildTimeline(
    [row({ id: "1", eventType: "booking.payment_confirmed", label: "Paid diagnostic booking confirmed" })],
    ZONE,
    TODAY,
  );

  assert.equal(day?.entries[0]?.title, "Diagnostic fee paid");
  assert.equal(day?.entries[0]?.kind, "money");
});

test("an unknown event still appears, in the writer's words", () => {
  // The alternative is an event vanishing from the history because this file
  // has not caught up with the code that writes it.
  const [day] = buildTimeline(
    [row({ id: "1", eventType: "something.new", label: "Something happened" })],
    ZONE,
    TODAY,
  );

  assert.equal(day?.entries[0]?.title, "Something happened");
  assert.equal(day?.entries[0]?.kind, "other");
});

test("the booking that needs reviewing is not a customer review", () => {
  // It shipped labelled "Customer booking needs review", which reads as a
  // review from the customer. It means the opposite: a person has to look.
  const [day] = buildTimeline(
    [row({ id: "1", eventType: "booking.review_requested", label: "Customer booking needs review" })],
    ZONE,
    TODAY,
  );

  assert.equal(day?.entries[0]?.title, "Booking held for Nick to review");
  assert.equal(day?.entries[0]?.kind, "inquiry");
});

test("money and channel come off the metadata", () => {
  const [day] = buildTimeline(
    [
      row({
        id: "1",
        eventType: "booking.payment_confirmed",
        metadata: { amount_cents: 10000, via: "web" },
      }),
    ],
    ZONE,
    TODAY,
  );

  assert.equal(day?.entries[0]?.detail, "$100.00 · on the booking page");
});

test("a channel nobody mapped is shown as it was written", () => {
  // "text and email" wrapped in a preposition read "on the text and email".
  const [day] = buildTimeline(
    [row({ id: "1", eventType: "invoice.sent", metadata: { via: "text and email" } })],
    ZONE,
    TODAY,
  );

  assert.equal(day?.entries[0]?.detail, "text and email");
});

test("a text booking says so in words", () => {
  const [day] = buildTimeline(
    [row({ id: "1", eventType: "booking.fee_accepted", metadata: { via: "sms" } })],
    ZONE,
    TODAY,
  );

  assert.equal(day?.entries[0]?.detail, "by text");
});

test("days are grouped where the business is, not where the server is", () => {
  // 2026-08-20T02:00Z is still the 19th in Los Angeles. A server thinking in
  // UTC files the evening's work under tomorrow.
  const timeline = buildTimeline(
    [
      row({ id: "1", createdAt: "2026-08-20T02:00:00Z" }),
      row({ id: "2", createdAt: "2026-08-19T16:00:00Z" }),
    ],
    ZONE,
    TODAY,
  );

  assert.equal(timeline.length, 1);
  assert.equal(timeline[0]?.date, "2026-08-19");
  assert.equal(timeline[0]?.entries.length, 2);
});

test("newest first, by day and within the day", () => {
  const timeline = buildTimeline(
    [
      row({ id: "old", createdAt: "2026-08-17T18:00:00Z" }),
      row({ id: "newest", createdAt: "2026-08-19T20:00:00Z" }),
      row({ id: "middle", createdAt: "2026-08-19T16:00:00Z" }),
    ],
    ZONE,
    TODAY,
  );

  assert.deepEqual(
    timeline.map((day) => day.date),
    ["2026-08-19", "2026-08-17"],
  );
  assert.deepEqual(
    timeline[0]?.entries.map((entry) => entry.id),
    ["newest", "middle"],
  );
});

test("two events written in the same transaction keep a stable order", () => {
  // Same timestamp to the microsecond. Left to the sort, the order can differ
  // between two reads of the same page, and a history that reshuffles itself is
  // a history nobody believes.
  const same = "2026-08-19T18:00:00.123456Z";
  const first = buildTimeline(
    [row({ id: "aaa", createdAt: same }), row({ id: "bbb", createdAt: same })],
    ZONE,
    TODAY,
  );
  const second = buildTimeline(
    [row({ id: "bbb", createdAt: same }), row({ id: "aaa", createdAt: same })],
    ZONE,
    TODAY,
  );

  assert.deepEqual(
    first[0]?.entries.map((entry) => entry.id),
    second[0]?.entries.map((entry) => entry.id),
  );
});

test("the days somebody names rather than dates", () => {
  const timeline = buildTimeline(
    [
      row({ id: "1", createdAt: "2026-08-19T18:00:00Z" }),
      row({ id: "2", createdAt: "2026-08-18T18:00:00Z" }),
      row({ id: "3", createdAt: "2026-08-12T18:00:00Z" }),
    ],
    ZONE,
    TODAY,
  );

  assert.deepEqual(
    timeline.map((day) => day.label),
    ["Today", "Yesterday", "Wednesday 12 August"],
  );
});

test("money is written the way it is charged", () => {
  assert.equal(moneyLabel(10000), "$100.00");
  assert.equal(moneyLabel(9950), "$99.50");
  assert.equal(moneyLabel(0), "$0.00");
});

test("nonsense in, nothing out — never a row with a broken date", () => {
  const timeline = buildTimeline([row({ id: "1", createdAt: "not-a-date" })], ZONE, TODAY);
  assert.deepEqual(timeline, []);
});
