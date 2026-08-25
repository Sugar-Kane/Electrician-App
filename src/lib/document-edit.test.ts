import test from "node:test";
import assert from "node:assert/strict";

import {
  canEditContract,
  canEditInvoice,
  diffLines,
  linesSubtotalCents,
  readInvoiceLine,
  recomputeInvoice,
  spliceScope,
  type InvoiceLine,
} from "./document-edit.ts";

const BODY =
  "TERMS AND CONDITIONS\nPayment is due within 30 days.\n\nSCOPE OF WORK\nReplace the main panel.\n\nWARRANTY\nOne year on labour.";

test("a draft invoice nobody has seen is editable", () => {
  assert.deepEqual(
    canEditInvoice({ status: "draft", lastSentAt: null, paidAt: null }),
    { ok: true },
  );
});

test("an invoice the customer is holding is not editable", () => {
  // The failure this prevents: their copy and yours disagreeing, with only one
  // of them in the room during the argument.
  const verdict = canEditInvoice({
    status: "draft",
    lastSentAt: "2026-08-20T10:00:00Z",
    paidAt: null,
  });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.because : "", /already gone to the customer/);
});

test("a sent-then-reset invoice is still locked", () => {
  // The status says draft. The timestamp says a customer has a copy. The
  // timestamp is a record of something that happened; the status is a label.
  const verdict = canEditInvoice({
    status: "draft",
    lastSentAt: "2026-08-20T10:00:00Z",
    paidAt: null,
  });

  assert.equal(verdict.ok, false);
});

test("a paid invoice says to raise a new one rather than just refusing", () => {
  const verdict = canEditInvoice({
    status: "paid",
    lastSentAt: "2026-08-20T10:00:00Z",
    paidAt: "2026-08-21T10:00:00Z",
  });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.because : "", /Raise a new invoice|credit/);
});

test("every non-draft status is refused in words a person can act on", () => {
  for (const status of ["sent", "partially_paid", "overdue", "void"]) {
    const verdict = canEditInvoice({ status, lastSentAt: null, paidAt: null });
    assert.equal(verdict.ok, false, status);
    assert.ok(verdict.ok === false && verdict.because.length > 20, status);
  }
});

test("a signed contract is amended, not edited", () => {
  const verdict = canEditContract({ status: "signed" });

  assert.equal(verdict.ok, false);
  assert.match(verdict.ok === false ? verdict.because : "", /amended in writing/);
});

test("a draft contract is editable, which is every contract today", () => {
  assert.deepEqual(canEditContract({ status: "draft" }), { ok: true });
  assert.equal(canEditContract({ status: "sent" }).ok, false);
  assert.equal(canEditContract({ status: "void" }).ok, false);
});

test("the scope is replaced and the terms around it are untouched", () => {
  const next = spliceScope(BODY, "Replace the main panel.", "Replace the main panel and add a surge protector.");

  assert.ok(next);
  assert.match(next, /surge protector/);
  // The two things that must survive, checked by name.
  assert.match(next, /Payment is due within 30 days\./);
  assert.match(next, /One year on labour\./);
});

test("a body that no longer contains the recorded scope is refused", () => {
  // Somebody edited the contract by hand. Splicing now would land the new text
  // in the wrong place, and the wrong place is the terms.
  assert.equal(spliceScope(BODY, "Replace the sub panel.", "anything"), null);
});

test("a scope appearing twice is refused rather than guessed at", () => {
  const twice = "SCOPE\nSame text.\n\nAPPENDIX\nSame text.";
  assert.equal(spliceScope(twice, "Same text.", "New text."), null);
});

test("nothing to splice with is refused", () => {
  assert.equal(spliceScope(BODY, "", "New scope"), null);
  assert.equal(spliceScope(BODY, "Replace the main panel.", ""), null);
  assert.equal(spliceScope("", "a", "b"), null);
});

test("the diff shows the changed line and keeps its surroundings", () => {
  const rows = diffLines("one\ntwo\nthree", "one\nTWO\nthree");

  assert.deepEqual(rows, [
    { kind: "same", text: "one" },
    { kind: "removed", text: "two" },
    { kind: "added", text: "TWO" },
    { kind: "same", text: "three" },
  ]);
});

test("an unchanged document diffs to nothing added or removed", () => {
  const rows = diffLines(BODY, BODY);
  assert.equal(rows.every((row) => row.kind === "same"), true);
});

test("a line with no description is not a line", () => {
  assert.equal(readInvoiceLine({ description: "  ", quantity: 2 }), null);
  assert.equal(readInvoiceLine(null), null);
});

test("labour is spelled the way the check constraint accepts", () => {
  // job_line_items_kind_check holds 'labor'. Shipping 'labour' here rejected
  // every work-order line once already.
  assert.equal(readInvoiceLine({ description: "Panel work" })?.kind, "labor");
  assert.equal(readInvoiceLine({ description: "Breaker", kind: "material" })?.kind, "material");
});

test("an unreadable price is 0 rather than a plausible invention", () => {
  const line = readInvoiceLine({ description: "Breaker", quantity: "two", unit_price_cents: "lots" });

  assert.equal(line?.quantity, 1);
  assert.equal(line?.unitPriceCents, 0);
  assert.equal(line?.unit, "hour");
});

test("the subtotal is the line table a customer could add up themselves", () => {
  const lines: InvoiceLine[] = [
    { kind: "labor", description: "Labour", quantity: 6, unit: "hour", unitPriceCents: 12_500 },
    { kind: "material", description: "Panel", quantity: 1, unit: "each", unitPriceCents: 48_000 },
  ];

  assert.equal(linesSubtotalCents(lines), 75_000 + 48_000);
});

test("editing a line moves every figure together", () => {
  // The failure this prevents is an invoice whose subtotal contradicts its own
  // line table — wrong in a way that reads as deliberate.
  const before: InvoiceLine[] = [
    { kind: "labor", description: "Labour", quantity: 6, unit: "hour", unitPriceCents: 12_500 },
  ];
  const after: InvoiceLine[] = [
    { kind: "labor", description: "Labour", quantity: 8, unit: "hour", unitPriceCents: 12_500 },
  ];

  const carried = { diagnosticCreditCents: 18_000, taxCents: 5_000 };
  const first = recomputeInvoice(before, carried);
  const second = recomputeInvoice(after, carried);

  assert.equal(first.subtotalCents, 75_000);
  assert.equal(second.subtotalCents, 100_000);

  // Subtotal less the credit, plus tax — the order a customer checks it in.
  assert.equal(first.totalCents, 75_000 - 18_000 + 5_000);
  assert.equal(second.totalCents, 100_000 - 18_000 + 5_000);

  // And the platform's cut follows what is actually collected.
  assert.ok(second.applicationFeeCents > first.applicationFeeCents);
});

test("emptying the lines does not produce a negative invoice", () => {
  const totals = recomputeInvoice([], { diagnosticCreditCents: 18_000, taxCents: 0 });

  assert.equal(totals.subtotalCents, 0);
  assert.equal(totals.totalCents, 0);
  // The credit cannot exceed the work, so an empty invoice owes nothing rather
  // than refunding a diagnostic nobody asked to have refunded.
  assert.equal(totals.diagnosticCreditCents, 0);
});
