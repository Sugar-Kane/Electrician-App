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
  assert.deepEqual(stage.primary, { kind: "visit", label: "Start trip", href: "#work" });
  assert.deepEqual(stage.steps.map((step) => step.label), ["Intake", "Schedule", "Travel", "Diagnose", "Next step", "Invoice"]);
});

test("B: a finished diagnostic whose fee is owed asks what happens next", () => {
  const stage = jobFlow(
    input({ kindOfWork: "Diagnostic", workflowState: "completed", diagnosticFeeDue: true, progress: progress({ kindOfWork: "Diagnostic", workflowState: "completed" }) }),
  );
  assert.equal(stage.needsDecision, true);
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Select next action");
});

test("C: once the fee or a repair is on the job, the diagnostic goes to billing", () => {
  const stage = jobFlow(
    input({
      kindOfWork: "Diagnostic",
      workflowState: "completed",
      lineCount: 1,
      diagnosticFeeDue: true,
      progress: progress({ kindOfWork: "Diagnostic", workflowState: "completed", pricedCents: 18_000 }),
    }),
  );
  assert.equal(stage.needsDecision, false);
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Generate invoice");
});

test("C2: a fee paid at booking with the repair booked as a work order bills nothing more here", () => {
  const stage = jobFlow(
    input({ kindOfWork: "Diagnostic", workflowState: "completed", followUpCount: 1, progress: progress({ kindOfWork: "Diagnostic", workflowState: "completed" }) }),
  );
  assert.equal(stage.primary.kind, "none");
  assert.equal(stage.needsDecision, false);
});

test("D: a work order with no scope builds the material list first", () => {
  const stage = jobFlow(input());
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Build material list");
  assert.deepEqual(stage.steps.map((step) => step.label), ["Materials list", "Supplier quotes", "Estimate", "Contract", "Pick up parts", "Schedule", "Work", "Invoice"]);
});

test("E: unpriced list items need supplier quotes, never a made-up price", () => {
  const stage = jobFlow(input({ materialListCount: 4, unpricedMaterialCount: 2 }));
  assert.equal(stage.primary.kind === "go" && stage.primary.label, "Get supplier quotes");
});

test("F: priced but unapproved work is not dispatched", () => {
  const unsent = jobFlow(input({ lineCount: 3, partCount: 2 }));
  assert.equal(unsent.primary.kind === "go" && unsent.primary.label, "Send contract");
  const sent = jobFlow(input({ lineCount: 3, partCount: 2, agreement: { sent: true, signed: false } }));
  assert.equal(sent.primary.kind === "go" && sent.primary.label, "View contract");
  assert.notEqual(sent.primary.kind, "visit");
});

test("G: approved work gathers materials, then books, then starts the trip", () => {
  const signed = { sent: true, signed: true };
  const gather = jobFlow(input({ lineCount: 3, partCount: 2, agreement: signed }));
  assert.equal(gather.primary.kind, "materials_ready");
  const book = jobFlow(input({ lineCount: 3, partCount: 2, agreement: signed, materialsReady: true, scheduled: false }));
  assert.equal(book.primary.kind === "go" && book.primary.label, "Confirm appointment");
  const go = jobFlow(input({ lineCount: 3, partCount: 2, agreement: signed, materialsReady: true }));
  assert.deepEqual(go.primary, { kind: "visit", label: "Start trip", href: "#work" });
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

test("an invoice sent before signing waits for the signature, and says the invoice is out", () => {
  const sentSteps = progress({
    pricedCents: 159014,
    invoices: [{ status: "sent", lastSentAt: "2026-11-10T00:00:00Z", paidAt: null }],
  });
  const unsigned = jobFlow(input({ lineCount: 16, partCount: 15, progress: sentSteps }));
  assert.equal(unsigned.primary.kind === "go" && unsigned.primary.label, "Send contract");
  assert.match(unsigned.status, /Invoiced/);
  // Sent, not paid: the Invoice step is half filled.
  assert.equal(unsigned.steps.find((step) => step.key === "invoice")?.fill, "half");
  assert.equal(unsigned.steps.find((step) => step.key === "work")?.state, "todo");

  const waiting = jobFlow(input({ lineCount: 16, partCount: 15, agreement: { sent: true, signed: false }, progress: sentSteps }));
  assert.equal(waiting.primary.kind === "go" && waiting.primary.label, "View contract");

  const signed = jobFlow(input({ lineCount: 16, partCount: 15, agreement: { sent: true, signed: true }, progress: sentSteps }));
  assert.equal(signed.primary.kind === "go" && signed.primary.label, "Record payment");
});

test("paid before signing still waits for the signature; signed and paid goes to the visit", () => {
  const paidSteps = progress({
    pricedCents: 159014,
    invoices: [{ status: "paid", lastSentAt: "2026-11-10T00:00:00Z", paidAt: "2026-11-11T00:00:00Z" }],
  });
  const unsigned = jobFlow(input({ lineCount: 16, partCount: 15, materialsReady: true, agreement: { sent: true, signed: false }, progress: paidSteps }));
  assert.equal(unsigned.primary.kind === "go" && unsigned.primary.label, "View contract");
  assert.equal(unsigned.steps.find((step) => step.key === "invoice")?.state, "done");
  const signed = jobFlow(input({ lineCount: 16, partCount: 15, materialsReady: true, agreement: { sent: true, signed: true }, progress: paidSteps }));
  assert.deepEqual(signed.primary, { kind: "visit", label: "Start trip", href: "#work" });
});

test("a diagnostic added by hand sends its fee invoice first, then schedules; a repair is still decided on site", () => {
  const first = jobFlow(input({ kindOfWork: "Diagnostic", scheduled: false, feeInvoice: "to_bill", feeLabel: "$180.00" }));
  assert.equal(first.primary.kind, "fee_invoice");
  assert.equal(first.primary.label, "Send diagnostic fee invoice ($180.00)");

  const sent = jobFlow(input({ kindOfWork: "Diagnostic", scheduled: false, feeInvoice: "billed_unpaid", lineCount: 1 }));
  assert.equal(sent.primary.kind === "go" && sent.primary.label, "Schedule visit");
  assert.match(sent.status, /fee unpaid/);

  // The fee line is on the job already; the repair choice still comes up.
  const onSite = jobFlow(
    input({ kindOfWork: "Diagnostic", workflowState: "working", feeInvoice: "paid", lineCount: 1, repairLineCount: 0 }),
  );
  assert.equal(onSite.needsDecision, true);

  // Paid at booking: no fee invoice step.
  const prepaid = jobFlow(input({ kindOfWork: "Diagnostic", scheduled: false, feeInvoice: "none" }));
  assert.equal(prepaid.primary.kind === "go" && prepaid.primary.label, "Schedule visit");
});

test("the contract and the invoice each fill half when sent and the rest when signed or paid", () => {
  const sentContract = jobFlow(input({ lineCount: 3, partCount: 2, agreement: { sent: true, signed: false } }));
  assert.equal(sentContract.steps.find((step) => step.key === "approval")?.fill, "half");
  const signedContract = jobFlow(input({ lineCount: 3, partCount: 2, agreement: { sent: true, signed: true } }));
  const contract = signedContract.steps.find((step) => step.key === "approval");
  assert.equal(contract?.state, "done");
  assert.equal(contract?.fill, undefined);

  const sentSteps = progress({
    workflowState: "completed",
    pricedCents: 10000,
    agreement: { sent: true, signed: true },
    invoices: [{ status: "sent", lastSentAt: "2026-11-01T00:00:00Z", paidAt: null }],
  });
  const owed = jobFlow(input({ workflowState: "completed", lineCount: 2, agreement: { sent: true, signed: true }, progress: sentSteps }));
  const invoice = owed.steps.find((step) => step.key === "invoice");
  assert.equal(invoice?.fill, "half");
  assert.equal(invoice?.state, "current");
});
