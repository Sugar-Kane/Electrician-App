import assert from "node:assert/strict";
import test from "node:test";

import { approvalSummary } from "./approval-summary.ts";

test("a diagnostic fee already paid comes off what is left to pay", () => {
  assert.deepEqual(approvalSummary({ totalCents: 128_000, depositCents: 18_000, depositPaid: true }), {
    totalCents: 128_000,
    paidCents: 18_000,
    balanceCents: 110_000,
    dueBeforeWorkCents: 0,
  });
});

test("a fee not yet paid is due before work, and nothing is counted as paid", () => {
  assert.deepEqual(approvalSummary({ totalCents: 18_000, depositCents: 18_000, depositPaid: false }), {
    totalCents: 18_000,
    paidCents: 0,
    balanceCents: 18_000,
    dueBeforeWorkCents: 18_000,
  });
});

test("work with no fee at all owes its whole total", () => {
  assert.deepEqual(approvalSummary({ totalCents: 64_500, depositCents: 0, depositPaid: false }), {
    totalCents: 64_500,
    paidCents: 0,
    balanceCents: 64_500,
    dueBeforeWorkCents: 0,
  });
});

test("a fee larger than the work leaves nothing to pay, never a negative balance", () => {
  const summary = approvalSummary({ totalCents: 12_000, depositCents: 18_000, depositPaid: true });
  assert.equal(summary?.balanceCents, 0);
  assert.equal(summary?.paidCents, 18_000);
});

test("a diagnostic-only contract that was paid at booking owes nothing more", () => {
  const summary = approvalSummary({ totalCents: 18_000, depositCents: 18_000, depositPaid: true });
  assert.equal(summary?.balanceCents, 0);
});

test("a contract drawn up before figures were saved has no summary", () => {
  assert.equal(approvalSummary({ totalCents: null, depositCents: null, depositPaid: null }), null);
});

test("garbled figures are read as nothing rather than as money", () => {
  assert.deepEqual(approvalSummary({ totalCents: -500, depositCents: Number.NaN, depositPaid: true }), {
    totalCents: 0,
    paidCents: 0,
    balanceCents: 0,
    dueBeforeWorkCents: 0,
  });
});
