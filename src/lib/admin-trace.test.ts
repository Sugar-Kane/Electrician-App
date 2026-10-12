import test from "node:test";
import assert from "node:assert/strict";

import { parseTrace, traceProblems, traceStates } from "./admin-trace.ts";

const NOW = new Date("2026-10-12T18:00:00Z");

/** A finished work order: signed, invoiced from its two lines, paid. */
function trace(overrides: Record<string, unknown> = {}) {
  return parseTrace({
    job: {
      id: "j1",
      job_number: 1042,
      status: "completed",
      category: "work_order",
      scheduled_start: "2026-10-10T15:00:00Z",
      scheduled_end: "2026-10-10T17:00:00Z",
      created_at: "2026-10-01T15:00:00Z",
    },
    customer: { id: "c1", name: "Sarah Jones", phone: "8055550142", email: "sarah@example.com" },
    contracts: [
      { id: "k1", kind: "agreement", status: "signed", created_at: "2026-10-02T15:00:00Z", sent_at: "2026-10-02T15:05:00Z", signed_at: "2026-10-02T16:00:00Z" },
    ],
    lines: [
      { id: "l1", kind: "labor", quantity: 4, unit_price_cents: 12_500, invoice_id: "i1", created_at: "2026-10-01T16:00:00Z", stock_moved: 0 },
      { id: "l2", kind: "material", quantity: 1, unit_price_cents: 435_000, invoice_id: "i1", created_at: "2026-10-01T16:05:00Z", stock_moved: -1 },
    ],
    invoices: [
      {
        id: "i1", invoice_number: 77, status: "paid",
        subtotal_cents: 485_000, diagnostic_credit_cents: 18_000, tax_cents: 0, total_cents: 467_000, balance_due_cents: 0,
        created_at: "2026-10-10T18:00:00Z", last_sent_at: "2026-10-10T18:01:00Z", paid_at: "2026-10-11T12:00:00Z",
      },
    ],
    payments: [
      { id: "p0", status: "succeeded", amount_cents: 18_000, for_booking: true, created_at: "2026-09-30T12:00:00Z" },
      { id: "p1", status: "succeeded", amount_cents: 467_000, for_booking: false, created_at: "2026-10-11T12:00:00Z" },
    ],
    ...overrides,
  })!;
}

test("a job signed, invoiced from its lines and paid has nothing wrong", () => {
  assert.deepEqual(traceProblems(trace(), NOW), []);
  const states = Object.fromEntries(traceStates(trace(), NOW).map((state) => [state.label, state.value]));
  assert.equal(states.Invoice, "#77 · Paid");
  assert.equal(states.Payment, "Paid in full");
});

test("an invoice whose lines add to a different amount is reported with both figures", () => {
  const changed = trace();
  changed.invoices[0]!.subtotalCents = 480_000;
  changed.invoices[0]!.totalCents = 462_000;
  const problem = traceProblems(changed, NOW).find((entry) => entry.title.includes("doesn't match its lines"));
  assert.ok(problem);
  assert.match(problem.detail, /\$4,850\.00.*\$4,800\.00/);
});

test("an invoice total that is not subtotal less credit plus tax is reported", () => {
  const wrong = trace();
  wrong.invoices[0]!.totalCents = 485_000; // the $180 credit taken off nowhere
  const problem = traceProblems(wrong, NOW).find((entry) => entry.title.includes("total doesn't add up"));
  assert.ok(problem);
  assert.match(problem.detail, /is \$4,670\.00; the invoice says \$4,850\.00/);
});

test("a payment with no invoice is reported, but a deposit paid at booking is not", () => {
  const deposit = trace({ invoices: [], lines: [], payments: [{ id: "p0", status: "succeeded", amount_cents: 18_000, for_booking: true }], job: { id: "j1", job_number: 1, status: "confirmed", category: "diagnostic", created_at: "2026-10-01T00:00:00Z" } });
  assert.ok(!traceProblems(deposit, NOW).some((entry) => entry.title === "Payment with no invoice"));

  const stray = trace({ invoices: [], lines: [], payments: [{ id: "p1", status: "succeeded", amount_cents: 25_000, for_booking: false }] });
  const problem = traceProblems(stray, NOW).find((entry) => entry.title === "Payment with no invoice");
  assert.ok(problem);
  assert.match(problem.detail, /\$250\.00/);
});

test("work added after the customer signed is reported with its value", () => {
  const added = trace();
  added.lines.push({ id: "l3", kind: "material", description: "Surge protector", quantity: 1, unit: "each", unitPriceCents: 29_500, unitCostCents: null, invoiceId: null, fromStock: false, createdAt: "2026-10-05T12:00:00Z", stockTaken: 0 });
  const problem = traceProblems(added, NOW).find((entry) => entry.title === "Work added after the customer signed");
  assert.ok(problem);
  assert.match(problem.detail, /1 line \(\$295\.00\)/);
});
