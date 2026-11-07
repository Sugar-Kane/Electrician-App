import assert from "node:assert/strict";
import { test } from "node:test";

import {
  dueInstant,
  inView,
  isOverdue,
  readTaskFields,
  visibilityForJobLink,
  type ViewFacts,
} from "./task-rules.ts";

const LA = "America/Los_Angeles";

function task(overrides: Partial<ViewFacts> = {}): ViewFacts {
  return {
    status: "todo",
    due_date: null,
    due_at: null,
    archived_at: null,
    assignee_type: "user",
    assignee_user_id: "me",
    created_by: "me",
    owner_id: "me",
    ...overrides,
  };
}

test("a task needs only a title, and the title is required", () => {
  const made = readTaskFields({ title: "  Order the panel  " }, { creating: true, defaultTimeZone: LA });
  assert.ok(made.ok);
  assert.equal(made.value.title, "Order the panel");
  assert.equal(made.value.time_zone, LA);
  const empty = readTaskFields({ title: "   " }, { creating: true, defaultTimeZone: LA });
  assert.equal(empty.ok, false);
});

test("a due time needs a date, and dates and times must be real", () => {
  assert.equal(readTaskFields({ title: "x", due_time: "09:00" }, { creating: true, defaultTimeZone: LA }).ok, false);
  assert.equal(readTaskFields({ title: "x", due_date: "2026-02-30" }, { creating: true, defaultTimeZone: LA }).ok, false);
  assert.equal(readTaskFields({ title: "x", due_date: "2026-11-14", due_time: "25:00" }, { creating: true, defaultTimeZone: LA }).ok, false);
  assert.equal(readTaskFields({ title: "x", time_zone: "Mars/Olympus" }, { creating: true, defaultTimeZone: LA }).ok, false);
});

test("a date-only deadline stays a calendar date with no instant", () => {
  const made = readTaskFields({ title: "x", due_date: "2026-11-14" }, { creating: true, defaultTimeZone: LA });
  assert.ok(made.ok);
  assert.equal(made.value.due_date, "2026-11-14");
  assert.equal(made.value.due_at, null);
});

test("a timed deadline is the instant it falls on in the task's zone, across daylight saving", () => {
  assert.equal(dueInstant("2026-11-14", "09:00", LA), "2026-11-14T17:00:00.000Z", "PST is UTC-8");
  assert.equal(dueInstant("2026-07-14", "09:00", LA), "2026-07-14T16:00:00.000Z", "PDT is UTC-7");
  // 2:30 on the night clocks go forward does not exist; it lands on 3:30.
  assert.equal(dueInstant("2026-03-08", "02:30", LA), "2026-03-08T10:30:00.000Z");
});

test("overdue is worked out: date-only from the next day, timed from the minute", () => {
  const evening = new Date("2026-11-15T03:00:00Z"); // Nov 14, 7pm in Los Angeles
  assert.equal(isOverdue(task({ due_date: "2026-11-14" }), LA, evening), false, "still the due day where the business is");
  assert.equal(isOverdue(task({ due_date: "2026-11-13" }), LA, evening), true);
  assert.equal(isOverdue(task({ due_date: "2026-11-14", due_at: "2026-11-15T01:00:00Z" }), LA, evening), true);
  assert.equal(isOverdue(task({ due_date: "2026-11-13", status: "complete" }), LA, evening), false, "a finished task is never overdue");
});

test("views: today has due-today, overdue and waiting-on-me; upcoming is future; all has undated", () => {
  const now = new Date("2026-11-14T18:00:00Z");
  assert.equal(inView(task({ due_date: "2026-11-14" }), "today", "me", LA, now), true);
  assert.equal(inView(task({ due_date: "2026-11-10" }), "today", "me", LA, now), true);
  assert.equal(inView(task({ status: "waiting_approval" }), "today", "me", LA, now), true);
  assert.equal(inView(task({ due_date: "2026-11-20" }), "today", "me", LA, now), false);
  assert.equal(inView(task({ due_date: "2026-11-20" }), "upcoming", "me", LA, now), true);
  assert.equal(inView(task(), "upcoming", "me", LA, now), false);
  assert.equal(inView(task(), "all", "me", LA, now), true);
  assert.equal(inView(task({ status: "complete" }), "all", "me", LA, now), false);
  assert.equal(inView(task({ status: "complete" }), "completed", "me", LA, now), true);
  assert.equal(inView(task({ archived_at: "2026-11-01T00:00:00Z" }), "all", "me", LA, now), false);
});

test("linking a private task to a job is refused until the visibility change is confirmed", () => {
  const refused = visibilityForJobLink("private", false);
  assert.equal(refused.ok, false);
  assert.equal(!refused.ok && refused.error.code, "VISIBILITY_CHANGE_NEEDS_CONFIRMATION");
  const agreed = visibilityForJobLink("private", true);
  assert.ok(agreed.ok && agreed.value.changed);
  const shared = visibilityForJobLink("workspace", false);
  assert.ok(shared.ok && !shared.value.changed);
});
