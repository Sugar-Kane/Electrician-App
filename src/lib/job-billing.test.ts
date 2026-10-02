import test from "node:test";
import assert from "node:assert/strict";

import {
  agreementChanges,
  changeOrderBody,
  lineLockedBecause,
  nextBillingStep,
  unbilledLines,
  type BillableLine,
  type ContractStanding,
  type InvoiceStanding,
} from "./job-billing.ts";

const line = (id: string, cents: number, invoiceId: string | null, createdAt: string, quantity = 1): BillableLine => ({
  id,
  description: `Line ${id}`,
  quantity,
  unit: "each",
  unitPriceCents: cents,
  invoiceId,
  createdAt,
});

const invoice = (id: string, overrides: Partial<InvoiceStanding> = {}): InvoiceStanding => ({
  id,
  number: id.replace(/\D/g, "") || "1",
  status: "draft",
  totalCents: 0,
  lastSentAt: null,
  paidAt: null,
  createdAt: "2026-10-01T10:00:00Z",
  ...overrides,
});

const contract = (id: string, overrides: Partial<ContractStanding> = {}): ContractStanding => ({
  id,
  kind: "agreement",
  status: "draft",
  createdAt: "2026-10-01T09:00:00Z",
  signedAt: null,
  ...overrides,
});

test("a line with no invoice, or on a voided one, is unbilled", () => {
  const lines = [line("a", 100, "inv1", "2026-10-01T09:00:00Z"), line("b", 200, null, "2026-10-01T11:00:00Z"), line("c", 300, "inv0", "2026-10-01T08:00:00Z")];
  const invoices = [invoice("inv1"), invoice("inv0", { status: "void" })];
  assert.deepEqual(unbilledLines(lines, invoices).map((row) => row.id), ["b", "c"]);
});

test("with no invoice, the first one bills everything", () => {
  const step = nextBillingStep([line("a", 12_500, null, "2026-10-01T09:00:00Z", 3), line("b", 4_850, null, "2026-10-01T09:01:00Z")], []);
  assert.deepEqual(step, { kind: "first", cents: 42_350, count: 2 });
});

test("added after a draft nobody has seen: onto that draft", () => {
  const draft = invoice("inv12");
  const step = nextBillingStep([line("a", 10_000, "inv12", "2026-10-01T09:00:00Z"), line("b", 2_298, null, "2026-10-02T09:00:00Z")], [draft]);
  assert.equal(step.kind, "add_to_draft");
  assert.equal(step.kind === "add_to_draft" && step.invoice.id, "inv12");
  assert.equal(step.kind === "add_to_draft" && step.cents, 2_298);
});

test("added after the invoice went out or was paid: a new invoice for the difference", () => {
  const lines = [line("a", 10_000, "inv12", "2026-10-01T09:00:00Z"), line("b", 2_298, null, "2026-10-02T09:00:00Z", 2)];
  for (const sent of [invoice("inv12", { status: "sent", lastSentAt: "2026-10-01T12:00:00Z" }), invoice("inv12", { status: "paid", paidAt: "2026-10-01T13:00:00Z" })]) {
    const step = nextBillingStep(lines, [sent]);
    assert.equal(step.kind, "bill_difference");
    assert.equal(step.kind === "bill_difference" && step.cents, 4_596);
    assert.equal(step.kind === "bill_difference" && step.count, 1);
  }
  // Marked draft again by hand, but it was texted to them: still settled.
  const step = nextBillingStep(lines, [invoice("inv12", { status: "draft", lastSentAt: "2026-10-01T12:00:00Z" })]);
  assert.equal(step.kind, "bill_difference");
});

test("the newest live invoice decides, and a voided one does not count", () => {
  const lines = [line("b", 500, null, "2026-10-03T09:00:00Z")];
  const paidFirst = invoice("inv1", { status: "paid", paidAt: "2026-10-01T12:00:00Z", createdAt: "2026-10-01T10:00:00Z" });
  const draftSecond = invoice("inv2", { createdAt: "2026-10-02T10:00:00Z" });
  assert.equal(nextBillingStep(lines, [paidFirst, draftSecond]).kind, "add_to_draft");
  assert.equal(nextBillingStep(lines, [paidFirst, { ...draftSecond, status: "void" }]).kind, "bill_difference");
});

test("everything billed, or nothing priced: nothing to do", () => {
  assert.deepEqual(nextBillingStep([line("a", 100, "inv1", "2026-10-01T09:00:00Z")], [invoice("inv1")]), { kind: "nothing" });
  assert.deepEqual(nextBillingStep([line("a", 0, null, "2026-10-01T09:00:00Z")], []), { kind: "nothing" });
});

test("a line on a sent or paid invoice stays on the job; one on an unseen draft can go", () => {
  const billed = line("a", 100, "inv12", "2026-10-01T09:00:00Z");
  assert.equal(lineLockedBecause(billed, [invoice("inv12")]), "");
  assert.equal(lineLockedBecause(line("b", 100, null, "2026-10-01T09:00:00Z"), [invoice("inv12")]), "");
  assert.equal(
    lineLockedBecause(billed, [invoice("inv12", { status: "sent", lastSentAt: "2026-10-01T12:00:00Z" })]),
    "Billed on INV-12, which has gone to the customer, so it stays on the job.",
  );
  assert.equal(
    lineLockedBecause(billed, [invoice("inv12", { status: "paid", paidAt: "2026-10-01T12:00:00Z" })]),
    "Billed on INV-12, which has been paid, so it stays on the job.",
  );
  assert.equal(lineLockedBecause(billed, [invoice("inv12", { status: "void", lastSentAt: "2026-10-01T12:00:00Z" })]), "");
});

test("nothing signed: no changes to agree, but a draft older than the lines is behind", () => {
  const lines = [line("a", 100, null, "2026-10-01T08:00:00Z"), line("b", 200, null, "2026-10-01T10:00:00Z")];
  const changes = agreementChanges(lines, [contract("c1", { createdAt: "2026-10-01T09:00:00Z" })]);
  assert.equal(changes.signed, null);
  assert.deepEqual(changes.added, []);
  assert.equal(changes.behind, true);
  assert.equal(agreementChanges(lines.slice(0, 1), [contract("c1", { createdAt: "2026-10-01T09:00:00Z" })]).behind, false);
});

test("lines written after the signed contract was drawn up are the change", () => {
  const signed = contract("c1", { status: "signed", createdAt: "2026-10-01T09:00:00Z", signedAt: "2026-10-01T15:00:00Z" });
  const lines = [
    line("a", 100_000, null, "2026-10-01T08:00:00Z"),
    // Written after the contract was drawn up but before the customer signed
    // it: the copy they signed did not have it.
    line("b", 4_850, null, "2026-10-01T12:00:00Z"),
    line("c", 12_500, null, "2026-10-02T09:00:00Z", 3),
  ];
  const changes = agreementChanges(lines, [signed]);
  assert.equal(changes.signed?.id, "c1");
  assert.deepEqual(changes.added.map((row) => row.id), ["b", "c"]);
  assert.equal(changes.addedCents, 4_850 + 37_500);
  assert.equal(changes.waiting, null);
  assert.equal(changes.behind, false);
});

test("a change order drawn up after the additions is waiting; one drawn up before some is behind", () => {
  const signed = contract("c1", { status: "signed", createdAt: "2026-10-01T09:00:00Z", signedAt: "2026-10-01T15:00:00Z" });
  const lines = [line("a", 100, null, "2026-10-01T08:00:00Z"), line("b", 200, null, "2026-10-02T09:00:00Z")];
  const order = contract("c2", { kind: "change_order", createdAt: "2026-10-02T10:00:00Z" });
  const waiting = agreementChanges(lines, [signed, order]);
  assert.equal(waiting.waiting?.id, "c2");
  assert.equal(waiting.behind, false);

  const later = [...lines, line("c", 300, null, "2026-10-02T11:00:00Z")];
  const behind = agreementChanges(later, [signed, order]);
  assert.equal(behind.waiting, null);
  assert.equal(behind.behind, true);
  assert.deepEqual(behind.added.map((row) => row.id), ["b", "c"]);
});

test("once the change order is signed, it is what was agreed", () => {
  const lines = [line("a", 100, null, "2026-10-01T08:00:00Z"), line("b", 200, null, "2026-10-02T09:00:00Z")];
  const changes = agreementChanges(lines, [
    contract("c1", { status: "signed", createdAt: "2026-10-01T09:00:00Z", signedAt: "2026-10-01T15:00:00Z" }),
    contract("c2", { kind: "change_order", status: "signed", createdAt: "2026-10-02T10:00:00Z", signedAt: "2026-10-02T10:30:00Z" }),
  ]);
  assert.equal(changes.signed?.id, "c2");
  assert.deepEqual(changes.added, []);
});

test("a voided contract is not what anybody agreed to", () => {
  const lines = [line("a", 100, null, "2026-10-02T09:00:00Z")];
  const changes = agreementChanges(lines, [
    contract("c1", { status: "void", createdAt: "2026-10-01T09:00:00Z", signedAt: "2026-10-01T15:00:00Z" }),
  ]);
  assert.equal(changes.signed, null);
});

test("a change order lists what was added and what it comes to", () => {
  const filled = changeOrderBody({
    facts: {
      today: "Oct 3, 2026",
      business_name: "Pacific Plains Electric",
      customer_name: "Harbor View Apartments",
      job_number: "15",
      service_address: "200 Harbor Way, Morro Bay, CA",
    },
    signedOn: "Oct 1, 2026",
    lines: [
      { description: "60A double-pole breaker", quantity: 1, unit: "each", unitPriceCents: 4_850 },
      { description: "Install 60A EV charger circuit", quantity: 3, unit: "hr", unitPriceCents: 12_500 },
    ],
  });
  assert.deepEqual(filled.unfilled, []);
  assert.match(filled.body, /^CHANGE ORDER\n\nThis change order is made on Oct 3, 2026 between Pacific Plains Electric/);
  assert.match(filled.body, /job 15 at 200 Harbor Way, Morro Bay, CA, signed on Oct 1, 2026\./);
  assert.match(filled.body, /WORK AND PARTS ADDED\n60A double-pole breaker — 1 each at \$48\.50: \$48\.50\nInstall 60A EV charger circuit — 3 hr at \$125\.00: \$375\.00/);
  assert.match(filled.body, /These additions come to \$423\.50, on top of the price already agreed\./);
});

test("a missing name is a blank to fill in, and typed braces are not", () => {
  const filled = changeOrderBody({
    facts: { today: "Oct 3, 2026", business_name: "Pacific Plains Electric", job_number: "15", service_address: "200 Harbor Way" },
    signedOn: "Oct 1, 2026",
    lines: [{ description: "Relabel {{customer_name}} panel", quantity: 1, unit: "each", unitPriceCents: 1_000 }],
  });
  assert.deepEqual(filled.unfilled, ["customer_name"]);
  assert.match(filled.body, /Relabel \{customer_name\} panel/);
});
