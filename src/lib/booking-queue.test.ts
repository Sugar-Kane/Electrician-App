import test from "node:test";
import assert from "node:assert/strict";

import { HANDLED_DAYS, isOpenRequest, splitQueue } from "./booking-queue.ts";

const NOW = Date.parse("2026-08-25T12:00:00Z");
const daysAgo = (days: number) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

test("what is waiting on a person is never hidden and never ages out", () => {
  const queue = splitQueue(
    [
      { status: "new", receivedAt: daysAgo(200) },
      { status: "needs_review", receivedAt: daysAgo(90) },
    ],
    NOW,
  );

  // Six months old and still on the page, because nobody answered it.
  assert.equal(queue.open.length, 2);
  assert.equal(queue.agedOut, 0);
});

test("waiting on payment and escalated for safety are waiting on a person", () => {
  // Both used to be filed as handled, which greyed them out at the bottom of
  // the page with their buttons hidden — the two states most needing somebody.
  assert.equal(isOpenRequest("awaiting_payment"), true);
  assert.equal(isOpenRequest("safety_escalated"), true);

  assert.equal(isOpenRequest("new"), true);
  assert.equal(isOpenRequest("needs_review"), true);

  for (const done of ["scheduled", "confirmed", "dismissed", "canceled", "expired"]) {
    assert.equal(isOpenRequest(done), false, done);
  }
});

test("handled requests drop off after a week", () => {
  const queue = splitQueue(
    [
      { status: "scheduled", receivedAt: daysAgo(1) },
      { status: "dismissed", receivedAt: daysAgo(6) },
      { status: "canceled", receivedAt: daysAgo(8) },
      { status: "confirmed", receivedAt: daysAgo(40) },
    ],
    NOW,
  );

  assert.equal(queue.handled.length, 2);
  assert.equal(queue.agedOut, 2);
});

test("the boundary is a week, either side of it", () => {
  const justInside = splitQueue(
    [{ status: "scheduled", receivedAt: daysAgo(HANDLED_DAYS - 0.01) }],
    NOW,
  );
  assert.equal(justInside.handled.length, 1);

  const justOutside = splitQueue(
    [{ status: "scheduled", receivedAt: daysAgo(HANDLED_DAYS + 0.01) }],
    NOW,
  );
  assert.equal(justOutside.handled.length, 0);
  assert.equal(justOutside.agedOut, 1);
});

test("a row with no usable date is old, not new", () => {
  // A missing timestamp is not evidence that something just came in.
  const queue = splitQueue(
    [
      { status: "scheduled", receivedAt: "" },
      { status: "dismissed", receivedAt: "not a date" },
    ],
    NOW,
  );

  assert.equal(queue.handled.length, 0);
  assert.equal(queue.agedOut, 2);
});

test("order is kept, so the newest stays at the top of each list", () => {
  const queue = splitQueue(
    [
      { status: "new", receivedAt: daysAgo(0) },
      { status: "scheduled", receivedAt: daysAgo(1) },
      { status: "new", receivedAt: daysAgo(2) },
      { status: "scheduled", receivedAt: daysAgo(3) },
    ],
    NOW,
  );

  assert.deepEqual(
    queue.open.map((entry) => entry.receivedAt),
    [daysAgo(0), daysAgo(2)],
  );
  assert.deepEqual(
    queue.handled.map((entry) => entry.receivedAt),
    [daysAgo(1), daysAgo(3)],
  );
});

test("an empty queue is three empty answers, not a crash", () => {
  const queue = splitQueue([], NOW);
  assert.deepEqual(queue, { open: [], handled: [], agedOut: 0 });
});
