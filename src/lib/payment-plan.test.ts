import test from "node:test";
import assert from "node:assert/strict";

import { amountDueNow, maxDownPaymentCents, planAmounts, planDepositCents, planSummaryLines } from "./payment-plan.ts";

test("a percentage deposit is of the contract total, and the balance is the rest", () => {
  const plan = planAmounts(100_000, [{ kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" }]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(plan.payments.map((payment) => payment.cents), [10_000, 90_000]);
  assert.equal(planDepositCents(plan.payments), 10_000);
});

test("California caps the down payment at 10% or $1,000, whichever is less", () => {
  assert.equal(maxDownPaymentCents(500_000), 50_000);
  assert.equal(maxDownPaymentCents(1_500_000), 100_000);
  // $5,000 job: 10% is allowed, 25% is not.
  assert.equal(planAmounts(500_000, [{ kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" }]).ok, true);
  assert.equal(planAmounts(500_000, [{ kind: "deposit", amountType: "percent", percentBps: 2500, due: "on_signing" }]).ok, false);
  // $15,000 job: 10% ($1,500) is over $1,000; $1,000 is allowed.
  assert.equal(planAmounts(1_500_000, [{ kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" }]).ok, false);
  assert.equal(planAmounts(1_500_000, [{ kind: "deposit", amountType: "fixed", amountCents: 100_000, due: "on_signing" }]).ok, true);
  // Two payments due on signing count together.
  assert.equal(
    planAmounts(500_000, [
      { kind: "deposit", amountType: "fixed", amountCents: 30_000, due: "on_signing" },
      { kind: "installment", amountType: "fixed", amountCents: 30_000, due: "on_signing" },
    ]).ok,
    false,
  );
  // Installments later are not a down payment.
  assert.equal(
    planAmounts(500_000, [
      { kind: "deposit", amountType: "fixed", amountCents: 50_000, due: "on_signing" },
      { kind: "installment", amountType: "percent", percentBps: 4000, due: "on_date", dueDate: "2026-12-01" },
    ]).ok,
    true,
  );
});

test("payments always add up to the total exactly, rounding included", () => {
  const plan = planAmounts(33_200, [
    { kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" },
    { kind: "installment", amountType: "percent", percentBps: 3333, due: "on_date", dueDate: "2026-12-01" },
  ]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(plan.payments.reduce((sum, payment) => sum + payment.cents, 0), 33_200);
  assert.equal(plan.payments.at(-1)?.kind, "final");
});

test("a plan that asks for the whole total or more before the balance is refused", () => {
  assert.equal(planAmounts(10_000, [{ kind: "deposit", amountType: "fixed", amountCents: 10_000, due: "on_signing" }]).ok, false);
  assert.equal(planAmounts(10_000, [{ kind: "deposit", amountType: "percent", percentBps: 12_000, due: "on_signing" }]).ok, false);
});

test("every payment needs an amount, and a dated one its date", () => {
  assert.equal(planAmounts(10_000, [{ kind: "deposit", amountType: "fixed", amountCents: 0, due: "on_signing" }]).ok, false);
  assert.equal(planAmounts(10_000, [{ kind: "installment", amountType: "fixed", amountCents: 1_000, due: "on_date" }]).ok, false);
  assert.equal(planAmounts(0, []).ok, false);
});

test("what is due now: what has come due, less what was paid, never negative", () => {
  const plan = planAmounts(100_000, [
    { kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" },
    { kind: "installment", amountType: "fixed", amountCents: 25_000, due: "on_date", dueDate: "2026-12-01" },
  ]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const base = { today: "2026-11-20", signed: false, completed: false };
  assert.equal(amountDueNow(plan.payments, { ...base, paidCents: 0 }), 0);
  assert.equal(amountDueNow(plan.payments, { ...base, signed: true, paidCents: 0 }), 10_000);
  assert.equal(amountDueNow(plan.payments, { ...base, signed: true, paidCents: 10_000 }), 0);
  assert.equal(amountDueNow(plan.payments, { ...base, signed: true, today: "2026-12-01", paidCents: 10_000 }), 25_000);
  // Finished before a dated installment: the balance is due, the installment
  // still waits for its date (paying over time after the work).
  assert.equal(amountDueNow(plan.payments, { ...base, signed: true, completed: true, paidCents: 10_000 }), 65_000);
  // Paid more than was due: nothing more is asked for.
  assert.equal(amountDueNow(plan.payments, { ...base, signed: true, paidCents: 90_000 }), 0);
});

test("the contract says each payment in plain words", () => {
  const plan = planAmounts(100_000, [{ kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" }]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.deepEqual(planSummaryLines(plan.payments, (date) => date), [
    "Deposit $100.00 (10%) due on signing.",
    "Balance $900.00 due on completion of the work.",
  ]);
});

test("the contract carries the payment schedule, and no longer says the balance is due on completion", async () => {
  const { contractPaymentTerms, withPaymentSchedule } = await import("./payment-plan.ts");
  const plan = planAmounts(100_000, [{ kind: "deposit", amountType: "percent", percentBps: 1000, due: "on_signing" }]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const terms = contractPaymentTerms(plan.payments, (date) => date);
  assert.equal(terms.depositCents, 10_000);
  const body = "PRICE\nTotal: $1,000.00\nDeposit due before work begins: $100.00\n\nPAYMENT\nThe balance is due on completion of the work described above.";
  const next = withPaymentSchedule(body, terms.block);
  assert.match(next, /Deposit due before work begins: \$100\.00\n\nPAYMENT SCHEDULE\n1\. Deposit \$100\.00 \(10%\) due on signing\.\n2\. Balance \$900\.00/);
  // The statutory down payment notice is on any contract with a deposit.
  assert.match(next, /THE DOWN PAYMENT MAY NOT EXCEED \$1,000 OR 10 PERCENT OF THE CONTRACT PRICE, WHICHEVER IS LESS\./);
  assert.doesNotMatch(next, /balance is due on completion of the work described above/);
  // No plan: the body is left as the template wrote it.
  assert.equal(withPaymentSchedule(body, ""), body);
});
