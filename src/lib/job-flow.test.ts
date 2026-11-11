import test from "node:test";
import assert from "node:assert/strict";

import { jobFlow, type StageInput } from "./job-flow.ts";
import { jobProgress, type ProgressInput } from "./job-progress.ts";

/*
 * What the job page offers as its one next step. Kept to the rules that gate
 * money and authorization: no dispatch on unapproved work, nothing billed
 * twice, a diagnostic's findings decided before it is invoiced.
 */

function progress(overrides: Partial<ProgressInput> = {}) {
  return jobProgress({
    kindOfWork: "Work order",
    scheduledLabel: "",
    scheduleHref: "/jobs/1/edit#window",
    workflowState: "scheduled",
    pricedCents: 0,
    partCount: 0,
    agreement: null,
    invoices: [],
    formatMoney: (cents) => `$${(cents / 100).toFixed(2)}`,
    ...overrides,
  }).steps;
}

function input(overrides: Partial<StageInput> = {}): StageInput {
  return {
    kindOfWork: "Work order",
    workflowState: "scheduled",
    scheduled: true,
    scheduleHref: "/jobs/1/edit#window",
    progress: progress(),
    lineCount: 0,
    partCount: 0,
    materialListCount: 0,
    unpricedMaterialCount: 0,
    materialsReady: false,
    agreement: null,
    followUpCount: 0,
    canceled: false,
    ...overrides,
  };
}

test("A: a scheduled diagnostic starts the trip", () => {
  const stage = jobFlow(input({ kindOfWork: "Diagnostic" }));
  assert.equal(stage.flow, "diagnostic");
  assert.deepEqual(stage.primary, { kind: "visit", label: "Start trip" });
  assert.deepEqual(stage.steps.map((step) => step.label), ["Intake", "Schedule", "Travel", "Diagnose", "Next step", "Invoice", "Paid"]);
});

test("B: a finished diagnostic asks what happens next before it is billed", () => {
  const stage = jobFlow(
    input({ kindOfWork: "Diagnostic", workflowState: "completed", progress: progress({ kindOfWork: "Diagnostic", workflowState: "completed" }) }),
  );
  assert.equal(stage.needsDecision, true);
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Select next action");
});

test("C: once a repair is booked, the diagnostic goes to billing", () => {
  const stage = jobFlow(
    input({
      kindOfWork: "Diagnostic",
      workflowState: "completed",
      followUpCount: 1,
      progress: progress({ kindOfWork: "Diagnostic", workflowState: "completed" }),
    }),
  );
  assert.equal(stage.needsDecision, false);
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Generate invoice");
});

test("D: a work order with no scope builds the material list first", () => {
  const stage = jobFlow(input());
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Build material list");
  assert.deepEqual(stage.steps.map((step) => step.label), ["Scope", "Quotes", "Estimate", "Approval", "Materials", "Schedule", "Work", "Invoice", "Paid"]);
});

test("E: unpriced list items need supplier quotes, never a made-up price", () => {
  const stage = jobFlow(input({ materialListCount: 4, unpricedMaterialCount: 2 }));
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Get supplier quotes");
});

test("F: priced but unapproved work is not dispatched", () => {
  const unsent = jobFlow(input({ lineCount: 3, partCount: 2 }));
  assert.equal(unsent.primary.kind === "go" && unsent.primary.label, "Send estimate");
  const sent = jobFlow(input({ lineCount: 3, partCount: 2, agreement: { sent: true, signed: false } }));
  assert.equal(sent.primary.kind === "go" && sent.primary.label, "View approval");
  assert.notEqual(sent.primary.kind, "visit");
});

test("G: approved work gathers materials, then books, then starts the trip", () => {
  const signed = { sent: true, signed: true };
  const gather = jobFlow(input({ lineCount: 3, partCount: 2, agreement: signed }));
  assert.equal(gather.primary.kind, "materials_ready");
  const book = jobFlow(input({ lineCount: 3, partCount: 2, agreement: signed, materialsReady: true, scheduled: false }));
  assert.equal(book.primary.kind === "go" && book.primary.label, "Confirm appointment");
  const go = jobFlow(input({ lineCount: 3, partCount: 2, agreement: signed, materialsReady: true }));
  assert.deepEqual(go.primary, { kind: "visit", label: "Start trip" });
});

test("H: billing runs invoice, payment, then closed; a canceled job offers nothing", () => {
  const paidSteps = progress({
    workflowState: "completed",
    pricedCents: 10000,
    agreement: { sent: true, signed: true },
    invoices: [{ status: "paid", lastSentAt: "2026-11-01T00:00:00Z", paidAt: "2026-11-02T00:00:00Z" }],
  });
  const closed = jobFlow(input({ workflowState: "completed", lineCount: 2, progress: paidSteps }));
  assert.equal(closed.primary.kind, "none");
  assert.equal(closed.status, "Paid");
  assert.ok(closed.steps.every((step) => step.state === "done"));

  const sentSteps = progress({
    workflowState: "completed",
    pricedCents: 10000,
    invoices: [{ status: "sent", lastSentAt: "2026-11-01T00:00:00Z", paidAt: null }],
  });
  const owed = jobFlow(input({ workflowState: "completed", lineCount: 2, progress: sentSteps }));
  assert.equal(owed.primary.kind === "go" && owed.primary.label, "Record payment");

  assert.equal(jobFlow(input({ canceled: true })).primary.kind, "none");
});
