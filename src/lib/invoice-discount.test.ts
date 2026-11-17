import assert from "node:assert/strict";
import { test } from "node:test";

import {
  discountColumns,
  discountFromRow,
  discountLabel,
  discountOn,
  invoiceTotals,
  readDiscount,
} from "./invoice-math.ts";

const tenPercent = { type: "percentage", basisPoints: 1000 } as const;

test("a percentage discount comes off the subtotal", () => {
  const totals = invoiceTotals({ subtotalCents: 200_000, discount: tenPercent });
  assert.equal(totals.discountCents, 20_000);
  assert.equal(totals.totalCents, 180_000);
});

test("a fixed discount comes off the subtotal", () => {
  const totals = invoiceTotals({ subtotalCents: 200_000, discount: { type: "fixed", cents: 15_000 } });
  assert.equal(totals.discountCents, 15_000);
  assert.equal(totals.totalCents, 185_000);
});

test("no discount is no discount line and the same total as before discounts existed", () => {
  const before = invoiceTotals({ subtotalCents: 220_000, taxCents: 0 });
  assert.equal(before.discountCents, 0);
  assert.equal(before.totalCents, 220_000);
  assert.deepEqual(invoiceTotals({ subtotalCents: 220_000, discount: null }), before);
});

test("a percentage discount follows the subtotal when it changes", () => {
  assert.equal(invoiceTotals({ subtotalCents: 200_000, discount: tenPercent }).totalCents, 180_000);
  // A change order adds $500: the 10% grows with it.
  const after = invoiceTotals({ subtotalCents: 250_000, discount: tenPercent });
  assert.equal(after.discountCents, 25_000);
  assert.equal(after.totalCents, 225_000);
});

test("a fixed discount stays what was agreed when the subtotal grows", () => {
  const after = invoiceTotals({ subtotalCents: 250_000, discount: { type: "fixed", cents: 20_000 } });
  assert.equal(after.discountCents, 20_000);
  assert.equal(after.totalCents, 230_000);
});

test("a fixed discount larger than shrunken work is held to the work, and says so", () => {
  const totals = invoiceTotals({ subtotalCents: 10_000, discount: { type: "fixed", cents: 15_000 } });
  assert.equal(totals.discountCents, 10_000);
  assert.equal(totals.discountCapped, true);
  assert.equal(totals.totalCents, 0);
});

test("a 100% discount leaves nothing owed and never a negative total", () => {
  const totals = invoiceTotals({ subtotalCents: 50_000, discount: { type: "percentage", basisPoints: 10_000 } });
  assert.equal(totals.totalCents, 0);
  assert.equal(totals.applicationFeeCents, 0);
});

test("percentages round half up, once, in whole cents", () => {
  // 10% of $10.05 is $1.005: a cent somebody has to pick.
  assert.equal(discountOn(1005, tenPercent).cents, 101);
  // 12.5% of $0.99 is 12.375 cents.
  assert.equal(discountOn(99, { type: "percentage", basisPoints: 1250 }).cents, 12);
  // 33.33% of $100.00 is $33.33 exactly.
  assert.equal(discountOn(10_000, { type: "percentage", basisPoints: 3333 }).cents, 3333);
});

test("the discount comes off before the diagnostic credit, and the credit cannot make it negative", () => {
  const totals = invoiceTotals({ subtotalCents: 20_000, discount: { type: "fixed", cents: 15_000 }, diagnosticPaidCents: 9_000 });
  assert.equal(totals.discountCents, 15_000);
  assert.equal(totals.diagnosticCreditCents, 5_000);
  assert.equal(totals.totalCents, 0);
});

test("tax is added after the discount, at the amount entered", () => {
  const totals = invoiceTotals({ subtotalCents: 220_000, discount: tenPercent, taxCents: 1_234 });
  assert.equal(totals.discountCents, 22_000);
  assert.equal(totals.totalCents, 198_000 + 1_234);
});

test("the platform fee is charged on what is collected after the discount", () => {
  const totals = invoiceTotals({ subtotalCents: 200_000, discount: tenPercent });
  assert.equal(totals.applicationFeeCents, 1_800);
});

test("typed discounts are read without floating point", () => {
  assert.deepEqual(readDiscount({ type: "percentage", value: "10", eligibleCents: 1 }), {
    ok: true,
    discount: { type: "percentage", basisPoints: 1000 },
  });
  assert.deepEqual(readDiscount({ type: "percentage", value: "12.5%", eligibleCents: 1 }), {
    ok: true,
    discount: { type: "percentage", basisPoints: 1250 },
  });
  assert.deepEqual(readDiscount({ type: "fixed", value: "$1,000.10", eligibleCents: 200_000 }), {
    ok: true,
    discount: { type: "fixed", cents: 100_010 },
  });
  // 0.29 * 100 is 28.999999999999996 in floating point; the digits say 29.
  assert.deepEqual(readDiscount({ type: "fixed", value: "0.29", eligibleCents: 100 }), {
    ok: true,
    discount: { type: "fixed", cents: 29 },
  });
});

test("discount limits: 0 to 100 percent, and never more than the subtotal", () => {
  assert.equal(readDiscount({ type: "percentage", value: "100.01", eligibleCents: 1 }).ok, false);
  assert.equal(readDiscount({ type: "percentage", value: "-5", eligibleCents: 1 }).ok, false);
  assert.equal(readDiscount({ type: "percentage", value: "10.555", eligibleCents: 1 }).ok, false);
  assert.equal(readDiscount({ type: "fixed", value: "2000.01", eligibleCents: 200_000 }).ok, false);
  assert.equal(readDiscount({ type: "fixed", value: "-1", eligibleCents: 200_000 }).ok, false);
  assert.equal(readDiscount({ type: "fixed", value: "abc", eligibleCents: 200_000 }).ok, false);
  assert.equal(readDiscount({ type: "bogus", value: "10", eligibleCents: 200_000 }).ok, false);
});

test("zero and none both mean no discount", () => {
  assert.deepEqual(readDiscount({ type: "percentage", value: "0", eligibleCents: 1 }), { ok: true, discount: null });
  assert.deepEqual(readDiscount({ type: "fixed", value: "0.00", eligibleCents: 1 }), { ok: true, discount: null });
  assert.deepEqual(readDiscount({ type: "none", value: "10", eligibleCents: 1 }), { ok: true, discount: null });
});

test("a discount survives the trip through its columns, and junk reads as none", () => {
  for (const discount of [tenPercent, { type: "fixed", cents: 15_000 } as const, null]) {
    assert.deepEqual(discountFromRow(discountColumns(discount)), discount);
  }
  assert.equal(discountFromRow({ discount_type: "percentage", discount_value: 0 }), null);
  assert.equal(discountFromRow({ discount_type: "other", discount_value: 100 }), null);
  assert.deepEqual(discountFromRow({ discount_type: "fixed", discount_value: "1500" }), { type: "fixed", cents: 1500 });
});

test("the printed label names the percentage, and only the percentage", () => {
  assert.equal(discountLabel(tenPercent), "Discount (10%)");
  assert.equal(discountLabel({ type: "percentage", basisPoints: 1250 }), "Discount (12.5%)");
  assert.equal(discountLabel({ type: "fixed", cents: 100 }), "Discount");
});
