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

test("money received pays the plan in order, and a pay link asks only for what is left", async () => {
  const { paymentsOwed, payLinkCents } = await import("./payment-plan.ts");
  const plan = planAmounts(500_000, [
    { kind: "deposit", amountType: "fixed", amountCents: 50_000, due: "on_signing" },
    { kind: "installment", amountType: "fixed", amountCents: 200_000, due: "on_date", dueDate: "2026-12-01" },
  ]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  // Nothing paid: the deposit link asks for the deposit.
  assert.equal(payLinkCents(plan.payments, 0, { prepaidCents: 0 }), 50_000);
  // Deposit paid in cash: its link asks for nothing, the next for the installment alone.
  assert.deepEqual(paymentsOwed(plan.payments, 50_000).map((each) => each.owedCents), [0, 200_000, 250_000]);
  assert.equal(payLinkCents(plan.payments, 0, { prepaidCents: 50_000 }), 0);
  assert.equal(payLinkCents(plan.payments, 1, { prepaidCents: 50_000 }), 200_000);
  // Deposit never paid: the installment's link includes it, never more than the plan.
  assert.equal(payLinkCents(plan.payments, 1, { prepaidCents: 0 }), 250_000);
  // A bank payment on its way counts, so it is not asked for twice.
  assert.equal(payLinkCents(plan.payments, 0, { prepaidCents: 0, processingCents: 50_000 }), 0);
  // Paid more than the plan: nothing is owed anywhere, never negative.
  assert.deepEqual(paymentsOwed(plan.payments, 900_000).map((each) => each.owedCents), [0, 0, 0]);
  assert.equal(payLinkCents(plan.payments, 2, { prepaidCents: 900_000 }), 0);
  assert.equal(payLinkCents(plan.payments, 7, { prepaidCents: 0 }), 0);
});

test("a payment is asked for automatically once, when due, and never after the invoice", async () => {
  const { shouldRequestPayment } = await import("./payment-plan.ts");
  const deposit = { kind: "deposit" as const, due: "on_signing" as const, dueDate: null };
  const dated = { kind: "installment" as const, due: "on_date" as const, dueDate: "2026-12-01" };
  const base = { requestedAt: null, owedCents: 50_000, today: "2026-11-20", signed: true, invoiceSent: false };
  assert.equal(shouldRequestPayment(deposit, base), true);
  assert.equal(shouldRequestPayment(deposit, { ...base, signed: false }), false);
  assert.equal(shouldRequestPayment(deposit, { ...base, requestedAt: "2026-11-19T10:00:00Z" }), false);
  assert.equal(shouldRequestPayment(deposit, { ...base, owedCents: 0 }), false);
  assert.equal(shouldRequestPayment(deposit, { ...base, invoiceSent: true }), false);
  assert.equal(shouldRequestPayment(dated, base), false);
  assert.equal(shouldRequestPayment(dated, { ...base, today: "2026-12-01" }), true);
  // The balance on completion is the invoice's job.
  assert.equal(shouldRequestPayment({ kind: "final", due: "on_completion", dueDate: null }, base), false);
});

test("only a payment the customer signed for is asked for automatically", async () => {
  const { matchesSignedSchedule } = await import("./payment-plan.ts");
  const dated = { kind: "installment" as const, cents: 200_000, due: "on_date" as const, dueDate: "2026-12-01" };
  const signed = [
    { kind: "deposit", cents: 50_000, due: "on_signing", dueDate: null },
    { kind: "installment", cents: 200_000, due: "on_date", dueDate: "2026-12-01" },
  ];
  assert.equal(matchesSignedSchedule(dated, 1, signed), true);
  // The date moved after signing.
  assert.equal(matchesSignedSchedule({ ...dated, dueDate: "2026-11-25" }, 1, signed), false);
  // The amount changed after signing.
  assert.equal(matchesSignedSchedule({ ...dated, cents: 250_000 }, 1, signed), false);
  // An installment added after signing.
  assert.equal(matchesSignedSchedule(dated, 2, signed), false);
  // No signed schedule at all.
  assert.equal(matchesSignedSchedule(dated, 1, null), false);
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
