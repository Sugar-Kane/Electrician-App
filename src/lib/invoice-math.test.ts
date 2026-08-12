import test from "node:test";
import assert from "node:assert/strict";

import {
  centsToDollars,
  diagnosticCreditFor,
  invoiceTotals,
  platformFeeCents,
  PLATFORM_FEE_BASIS_POINTS,
} from "./invoice-math.ts";

test("the platform takes five percent", () => {
  assert.equal(PLATFORM_FEE_BASIS_POINTS, 500);
  assert.equal(platformFeeCents(100_000), 5_000);
  assert.equal(platformFeeCents(128_000), 6_400);
  assert.equal(platformFeeCents(95_000), 4_750);
});

test("the fee rounds down, not up", () => {
  // Over thousands of invoices, "always rounds up in our favour" is a pattern
  // somebody eventually notices. The half-cent goes to the business doing the
  // work.
  assert.equal(platformFeeCents(1_999), 99); // 99.95 → 99
  assert.equal(platformFeeCents(19), 0); // 0.95 → 0
  assert.equal(platformFeeCents(21), 1); // 1.05 → 1
});

test("nothing owed means nothing taken", () => {
  assert.equal(platformFeeCents(0), 0);
  assert.equal(platformFeeCents(-5_000), 0);
  assert.equal(platformFeeCents(100_000, 0), 0);
});

test("an ordinary invoice adds up", () => {
  const totals = invoiceTotals({ subtotalCents: 128_000, taxCents: 0 });

  assert.equal(totals.subtotalCents, 128_000);
  assert.equal(totals.diagnosticCreditCents, 0);
  assert.equal(totals.totalCents, 128_000);
  assert.equal(totals.applicationFeeCents, 6_400);
});

test("a paid diagnostic comes off the follow-up invoice", () => {
  // The whole point: the customer paid $100 to have somebody look at it, and
  // that $100 counts toward the work that followed.
  const totals = invoiceTotals({ subtotalCents: 128_000, diagnosticPaidCents: 10_000 });

  assert.equal(totals.diagnosticCreditCents, 10_000);
  assert.equal(totals.totalCents, 118_000);
  // And the fee follows what is actually collected, not the pre-credit figure.
  assert.equal(totals.applicationFeeCents, 5_900);
});

test("a credit larger than the work does not produce a refund", () => {
  // A $75 job after a $100 diagnostic owes nothing. It does not owe minus
  // twenty-five dollars, and an invoice showing a negative total is a refund
  // nobody authorised.
  const totals = invoiceTotals({ subtotalCents: 7_500, diagnosticPaidCents: 10_000 });

  assert.equal(totals.diagnosticCreditCents, 7_500);
  assert.equal(totals.totalCents, 0);
  assert.equal(totals.applicationFeeCents, 0);
});

test("tax is charged after the credit, not before", () => {
  // Taxing the pre-credit figure would charge tax on money the customer is
  // not being asked for.
  const totals = invoiceTotals({
    subtotalCents: 100_000,
    diagnosticPaidCents: 10_000,
    taxCents: 7_425,
  });

  assert.equal(totals.totalCents, 97_425);
  assert.equal(totals.applicationFeeCents, 4_871); // 5% of 97,425 → 4871.25 → 4871
});

test("garbage in does not become a wrong total", () => {
  const totals = invoiceTotals({
    subtotalCents: Number.NaN,
    taxCents: Number.POSITIVE_INFINITY,
    diagnosticPaidCents: -500,
  });

  assert.equal(totals.subtotalCents, 0);
  assert.equal(totals.taxCents, 0);
  assert.equal(totals.diagnosticCreditCents, 0);
  assert.equal(totals.totalCents, 0);
  assert.equal(totals.applicationFeeCents, 0);
});

test("a fractional cent is rounded rather than carried", () => {
  const totals = invoiceTotals({ subtotalCents: 1_000.4 });
  assert.equal(totals.subtotalCents, 1_000);
  assert.equal(Number.isInteger(totals.applicationFeeCents), true);
});

test("the diagnostic invoice itself is not credited", () => {
  // Crediting the fee against the invoice that charges it nets to nothing, and
  // every diagnostic visit becomes free.
  assert.equal(
    diagnosticCreditFor({
      diagnosticPaid: true,
      diagnosticFeeCents: 10_000,
      existingInvoiceCount: 0,
    }),
    0,
  );
});

test("a follow-up invoice is credited once", () => {
  assert.equal(
    diagnosticCreditFor({
      diagnosticPaid: true,
      diagnosticFeeCents: 10_000,
      existingInvoiceCount: 1,
    }),
    10_000,
  );
});

test("a job invoiced in stages does not refund the diagnostic three times", () => {
  // A panel job billed across three invoices credits the $100 once. This is
  // the failure that would quietly cost the business real money.
  assert.equal(
    diagnosticCreditFor({
      diagnosticPaid: true,
      diagnosticFeeCents: 10_000,
      existingInvoiceCount: 2,
      alreadyCreditedCents: 10_000,
    }),
    0,
  );

  // Partially credited — because an earlier invoice was smaller than the fee —
  // leaves the remainder available.
  assert.equal(
    diagnosticCreditFor({
      diagnosticPaid: true,
      diagnosticFeeCents: 10_000,
      existingInvoiceCount: 2,
      alreadyCreditedCents: 4_000,
    }),
    6_000,
  );
});

test("an unpaid diagnostic is never credited", () => {
  // The customer has not handed over the money, so there is nothing to credit.
  assert.equal(
    diagnosticCreditFor({
      diagnosticPaid: false,
      diagnosticFeeCents: 10_000,
      existingInvoiceCount: 3,
    }),
    0,
  );
});

test("cents convert to dollars only for display", () => {
  assert.equal(centsToDollars(128_000), 1_280);
  assert.equal(centsToDollars(99), 0.99);
  assert.equal(centsToDollars(Number.NaN), 0);
});

test("a hundred invoices of the same amount sum exactly", () => {
  // The reason all of this is integer cents: floating point makes the
  // hundredth invoice disagree with the first, and nobody notices until a
  // customer adds up their year.
  let fees = 0;
  for (let index = 0; index < 100; index += 1) {
    fees += invoiceTotals({ subtotalCents: 33_333 }).applicationFeeCents;
  }

  assert.equal(fees, 166_600); // 1,666 × 100, exactly
  assert.equal(Number.isInteger(fees), true);
});
