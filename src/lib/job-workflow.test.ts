import test from "node:test";
import assert from "node:assert/strict";

import {
  canAdvance,
  isClosed,
  jobStatusFor,
  nextStep,
  showsWorkspace,
  stateLabel,
  watchesForArrival,
  workflowStateOf,
  WORKFLOW_STATES,
} from "./job-workflow.ts";

test("every status the database allows reads as a state", () => {
  // The check constraint on public.jobs.status. A status this does not know
  // falls back to "scheduled", which would offer Start trip on a completed job
  // — so the list is asserted rather than trusted.
  const stored = [
    "draft",
    "awaiting_payment",
    "confirmed",
    "needs_review",
    "assigned",
    "en_route",
    "arrived",
    "in_progress",
    "completed",
    "canceled",
    "no_show",
    "rescheduled",
  ];

  for (const status of stored) {
    assert.ok(
      WORKFLOW_STATES.includes(workflowStateOf(status)),
      `${status} does not map to a workflow state`,
    );
  }

  assert.equal(workflowStateOf("in_progress"), "working");
  assert.equal(workflowStateOf("needs_review"), "review");
  assert.equal(workflowStateOf("rescheduled"), "scheduled");
});

test("every state writes a status the database will accept", () => {
  // The inverse trip. `review` in particular writes `needs_review`, which has
  // been legal since the foundation migration and was never written by
  // anything — a state with nowhere to be stored would fail the constraint at
  // the moment somebody taps Finish job.
  const allowed = new Set([
    "draft",
    "awaiting_payment",
    "confirmed",
    "needs_review",
    "assigned",
    "en_route",
    "arrived",
    "in_progress",
    "completed",
    "canceled",
    "no_show",
    "rescheduled",
  ]);

  for (const state of WORKFLOW_STATES) {
    assert.ok(allowed.has(jobStatusFor(state)), `${state} writes an illegal status`);
  }
});

test("the happy path is one button at a time", () => {
  assert.deepEqual(nextStep("scheduled")?.to, "en_route");
  assert.deepEqual(nextStep("en_route")?.to, "arrived");
  assert.deepEqual(nextStep("arrived")?.to, "working");
  assert.deepEqual(nextStep("working")?.to, "review");
  assert.deepEqual(nextStep("review")?.to, "completed");
});

test("a finished or called-off job offers nothing to do next", () => {
  // Rather than a disabled button, which people tap twice before reading why.
  assert.equal(nextStep("completed"), null);
  assert.equal(nextStep("canceled"), null);
  assert.equal(nextStep("no_show"), null);

  assert.equal(isClosed("completed"), true);
  assert.equal(isClosed("canceled"), true);
  assert.equal(isClosed("no_show"), true);
  assert.equal(isClosed("working"), false);
});

test("the shortcuts the field actually needs are allowed", () => {
  // Somebody already outside the house when they open the app, and somebody
  // who got on with it without ever being marked arrived. Both were dead ends
  // that could only be escaped through the status dropdown. The screen confirms
  // the skipped arrival first; the machine allows it.
  assert.equal(canAdvance("scheduled", "arrived"), true);
  assert.equal(canAdvance("scheduled", "working"), true);
  assert.equal(canAdvance("en_route", "working"), true);
});

test("work can be reopened from review, and nothing can be reopened after that", () => {
  // Remembering a part after tapping Finish job is ordinary. A one-way door
  // there means the line goes on the next job or on none.
  assert.equal(canAdvance("review", "working"), true);
  assert.equal(canAdvance("completed", "working"), false);
  assert.equal(canAdvance("canceled", "en_route"), false);
});

test("a job cannot skip to the end", () => {
  assert.equal(canAdvance("scheduled", "completed"), false);
  assert.equal(canAdvance("scheduled", "review"), false);
  assert.equal(canAdvance("arrived", "review"), false);
  assert.equal(canAdvance("working", "completed"), false);
});

test("a job cannot go backwards into travel", () => {
  // Re-entering en_route would restart location monitoring on a job somebody
  // is standing in the middle of.
  assert.equal(canAdvance("arrived", "en_route"), false);
  assert.equal(canAdvance("working", "en_route"), false);
  assert.equal(canAdvance("working", "arrived"), false);
});

test("location is watched in exactly one state", () => {
  // The privacy rule, as a function rather than a comment: the component that
  // starts the watch and the one that stops it read the same answer.
  const watching = WORKFLOW_STATES.filter(watchesForArrival);
  assert.deepEqual(watching, ["en_route"]);
});

test("the workspace appears once somebody is at the property", () => {
  // From arrived rather than working: the photo of the panel as found is taken
  // before anything is touched.
  assert.equal(showsWorkspace("scheduled"), false);
  assert.equal(showsWorkspace("en_route"), false);
  assert.equal(showsWorkspace("arrived"), true);
  assert.equal(showsWorkspace("working"), true);
  assert.equal(showsWorkspace("review"), true);
  assert.equal(showsWorkspace("completed"), true);
});

test("every state says its name in words an electrician uses", () => {
  for (const state of WORKFLOW_STATES) {
    const label = stateLabel(state);
    assert.ok(label.length > 0, `${state} has no label`);
    assert.ok(!label.includes("_"), `${state} shows a database word: ${label}`);
  }

  assert.equal(stateLabel("en_route"), "On my way");
  assert.equal(stateLabel("working"), "Working");
});
