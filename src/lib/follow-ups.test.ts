import test from "node:test";
import assert from "node:assert/strict";

import { followUps, lateJobs, lateness, whenLabel, type FollowUpJob } from "./follow-ups.ts";

// Thursday October 1, 2026, 8:00 AM in Los Angeles (PDT, UTC-7).
const now = new Date("2026-10-01T15:00:00Z");
const zone = "America/Los_Angeles";

// Newer ICU puts a narrow no-break space before AM/PM; what matters is the words.
const plain = (text: string) => text.replace(/ /g, " ");

function job(overrides: Partial<FollowUpJob>): FollowUpJob {
  return { id: "1", customer: "Rosa Delgado", stage: "confirmed", ...overrides };
}

test("a job is not late until fifteen minutes after it was due to start", () => {
  // 7:46 AM: fourteen minutes ago. 7:44 AM: sixteen.
  assert.equal(lateness(job({ startsAt: "2026-10-01T14:46:00Z" }), now), null);
  assert.equal(lateness(job({ startsAt: "2026-10-01T14:44:00Z" }), now), "not_started");
  assert.equal(lateness(job({ stage: "assigned", startsAt: "2026-10-01T14:44:00Z" }), now), "not_started");
  assert.equal(lateness(job({ stage: "rescheduled", startsAt: "2026-10-01T14:44:00Z" }), now), "not_started");
});

test("a job still to come is not late", () => {
  assert.equal(lateness(job({ startsAt: "2026-10-01T20:00:00Z" }), now), null);
});

test("drafts, unpaid bookings and closed jobs are never late", () => {
  for (const stage of ["draft", "awaiting_payment", "canceled", "no_show", "completed"]) {
    assert.equal(lateness(job({ stage, startsAt: "2026-09-29T17:00:00Z", endsAt: "2026-09-29T19:00:00Z" }), now), null, stage);
  }
});

test("work under way is not finished fifteen minutes after it was due to end", () => {
  // Due to end 7:50 AM: ten minutes ago, so still running over rather than left open.
  assert.equal(lateness(job({ stage: "in_progress", startsAt: "2026-10-01T13:00:00Z", endsAt: "2026-10-01T14:50:00Z" }), now), null);
  // Due to end 7:40 AM: twenty minutes ago.
  assert.equal(lateness(job({ stage: "in_progress", startsAt: "2026-10-01T13:00:00Z", endsAt: "2026-10-01T14:40:00Z" }), now), "not_finished");
  assert.equal(lateness(job({ stage: "en_route", startsAt: "2026-09-29T17:00:00Z", endsAt: "2026-09-29T19:00:00Z" }), now), "not_finished");
  assert.equal(lateness(job({ stage: "arrived", startsAt: "2026-09-29T17:00:00Z", endsAt: "2026-09-29T19:00:00Z" }), now), "not_finished");
});

test("work under way with no end time is measured from its start", () => {
  assert.equal(lateness(job({ stage: "in_progress", startsAt: "2026-10-01T14:40:00Z" }), now), "not_finished");
  assert.equal(lateness(job({ stage: "in_progress", startsAt: "2026-10-01T14:50:00Z" }), now), null);
});

test("a job with no time on it cannot be late", () => {
  assert.equal(lateness(job({ startsAt: undefined }), now), null);
  assert.equal(lateness(job({ startsAt: "not a date" }), now), null);
});

test("times read as today, yesterday, or the date", () => {
  assert.equal(plain(whenLabel("2026-10-01T14:44:00Z", now, zone)), "Today, 7:44 AM");
  assert.equal(plain(whenLabel("2026-09-30T21:00:00Z", now, zone)), "Yesterday, 2:00 PM");
  assert.equal(plain(whenLabel("2026-09-29T17:00:00Z", now, zone)), "Tue, Sep 29, 10:00 AM");
  // 11:30 PM on Sep 30 in Los Angeles is already Oct 1 in UTC: still yesterday.
  assert.equal(plain(whenLabel("2026-10-01T06:30:00Z", now, zone)), "Yesterday, 11:30 PM");
});

test("work done and not signed off is listed once its time has come", () => {
  const items = followUps({
    jobs: [
      job({ id: "7", stage: "needs_review", startsAt: "2026-09-30T16:00:00Z" }),
      // Written ahead of the visit: not work done yet, so not listed.
      job({ id: "8", stage: "needs_review", startsAt: "2026-10-05T16:00:00Z" }),
    ],
    unbilled: {},
    now,
    timeZone: zone,
  });
  assert.deepEqual(items.map((item) => [item.jobNumber, item.kind]), [["7", "to_complete"]]);
  assert.equal(plain(items[0]!.detail), "Work done, not signed off · Yesterday, 9:00 AM");
});

test("finished work is listed only when there is something to bill", () => {
  const items = followUps({
    jobs: [
      job({ id: "18", customer: "Linda Park", stage: "completed", startsAt: "2026-09-30T16:00:00Z" }),
      // A prepaid diagnostic with nothing more recorded: nothing to chase.
      job({ id: "15", customer: "Adam", stage: "completed", startsAt: "2026-09-30T15:00:00Z" }),
    ],
    unbilled: { "18": 57_500, "15": 0 },
    now,
    timeZone: zone,
  });
  assert.deepEqual(items.map((item) => [item.jobNumber, item.kind]), [["18", "not_invoiced"]]);
  assert.equal(plain(items[0]!.detail), "Not invoiced · $575.00 of work · Yesterday, 9:00 AM");
});

test("the list runs from the most pressing kind, newest first within each", () => {
  const items = followUps({
    jobs: [
      job({ id: "24", customer: "Rosa Delgado", startsAt: "2026-09-30T21:00:00Z", endsAt: "2026-09-30T23:00:00Z" }),
      job({ id: "15", customer: "Adam", startsAt: "2026-10-01T14:40:00Z", endsAt: "2026-10-01T16:40:00Z" }),
      job({ id: "18", customer: "Linda Park", stage: "completed", startsAt: "2026-09-30T16:00:00Z" }),
      job({ id: "25", customer: "Brian Foster", stage: "in_progress", startsAt: "2026-09-29T17:00:00Z", endsAt: "2026-09-29T19:00:00Z" }),
      job({ id: "26", customer: "Maria Gonzalez", startsAt: "2026-10-01T20:00:00Z", endsAt: "2026-10-01T22:00:00Z" }),
    ],
    unbilled: { "18": 57_500 },
    now,
    timeZone: zone,
  });

  assert.deepEqual(
    items.map((item) => `${item.kind} #${item.jobNumber}`),
    ["not_finished #25", "not_started #15", "not_started #24", "not_invoiced #18"],
  );
  assert.equal(plain(items[0]!.detail), "Not finished · Tue, Sep 29, 10:00 AM");
  assert.equal(plain(items[1]!.detail), "Not started · Today, 7:40 AM");
  assert.equal(plain(items[2]!.detail), "Not started · Yesterday, 2:00 PM");
});

test("every row says whether it is a diagnostic or a work order", () => {
  const items = followUps({
    jobs: [
      job({ id: "25", kindOfWork: "Work order", stage: "in_progress", startsAt: "2026-09-29T17:00:00Z", endsAt: "2026-09-29T19:00:00Z" }),
      job({ id: "24", kindOfWork: "Diagnostic", startsAt: "2026-09-30T21:00:00Z" }),
      job({ id: "14", kindOfWork: "Diagnostic", stage: "needs_review", startsAt: "2026-09-30T16:00:00Z" }),
      job({ id: "18", kindOfWork: "Work order", stage: "completed", startsAt: "2026-09-30T16:00:00Z" }),
    ],
    unbilled: { "18": 57_500 },
    now,
    timeZone: zone,
  });

  assert.deepEqual(
    items.map((item) => `${item.kind} #${item.jobNumber} ${item.kindOfWork}`),
    [
      "not_finished #25 Work order",
      "not_started #24 Diagnostic",
      "to_complete #14 Diagnostic",
      "not_invoiced #18 Work order",
    ],
  );
  // Beside the detail, not inside it: the line under the name is still what is
  // left and when.
  assert.equal(plain(items[0]!.detail), "Not finished · Tue, Sep 29, 10:00 AM");
});

test("the late jobs, by number, for the status pills", () => {
  assert.deepEqual(
    lateJobs(
      [
        job({ id: "24", startsAt: "2026-09-30T21:00:00Z" }),
        job({ id: "25", stage: "in_progress", startsAt: "2026-09-29T17:00:00Z", endsAt: "2026-09-29T19:00:00Z" }),
        job({ id: "26", startsAt: "2026-10-01T20:00:00Z" }),
        job({ id: "16", stage: "completed", startsAt: "2026-09-16T16:00:00Z" }),
      ],
      now,
    ),
    { "24": "not_started", "25": "not_finished" },
  );
});
