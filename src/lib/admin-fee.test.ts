import test from "node:test";
import assert from "node:assert/strict";

import { adminFeeLabel, adminFeeOn, lineAdminFee, linesAdminFee, withAdminFee } from "./admin-fee.ts";

test("the admin fee is built into the customer's price, rounded to the cent", () => {
  assert.equal(adminFeeOn(10000, 400), 400, "4% of $100 is $4");
  assert.equal(withAdminFee(10000, 400), 10400);
  assert.equal(adminFeeOn(1263, 400), 51, "4% of $12.63 is 50.52 cents, so 51");
  assert.equal(adminFeeOn(1262, 400), 50, "50.48 cents rounds down");
  assert.equal(adminFeeOn(12, 400), 0, "a fraction of a cent is no fee");
});

test("no rate, or a nonsense one, adds nothing; a rate above the cap is held to it", () => {
  assert.equal(withAdminFee(10000, 0), 10000, "a job from before the fee keeps its price");
  assert.equal(withAdminFee(10000, -400), 10000);
  assert.equal(withAdminFee(10000, Number.NaN), 10000);
  assert.equal(adminFeeOn(10000, 5000), 2000, "never more than 20%");
  assert.equal(withAdminFee(-500, 400), 0, "a negative price is not a price");
});

test("the fee on a line is exactly the difference the customer pays, whatever the quantity", () => {
  // $25.00 a unit at 4% is stored as $26.00 with $1.00 of fee.
  assert.equal(lineAdminFee({ quantity: 3, unitPriceCents: 2600, adminFeeCents: 100 }), 300);
  // A fractional quantity rounds the same way the line total does.
  const line = { quantity: 2.5, unitPriceCents: 1313, adminFeeCents: 51 };
  const charged = Math.round(2.5 * 1313);
  const business = Math.round(2.5 * (1313 - 51));
  assert.equal(lineAdminFee(line), charged - business);
});

test("lines from before the fee, and agreed prices written with none, carry no fee", () => {
  assert.equal(lineAdminFee({ quantity: 1, unitPriceCents: 9900, adminFeeCents: null }), 0);
  assert.equal(lineAdminFee({ quantity: 1, unitPriceCents: 9900 }), 0);
  assert.equal(lineAdminFee({ quantity: 1, unitPriceCents: 9900, adminFeeCents: 0 }), 0, "the diagnostic fee");
  assert.equal(
    linesAdminFee([
      { quantity: 2, unitPriceCents: 10400, adminFeeCents: 400 },
      { quantity: 1, unitPriceCents: 9900, adminFeeCents: 0 },
    ]),
    800,
  );
});

test("a fee recorded as larger than the price never turns into a negative business price", () => {
  assert.equal(lineAdminFee({ quantity: 1, unitPriceCents: 100, adminFeeCents: 500 }), 100);
});

test("the business reads the rate as a percentage", () => {
  assert.equal(adminFeeLabel(400), "4%");
  assert.equal(adminFeeLabel(450), "4.5%");
  assert.equal(adminFeeLabel(0), "0%");
});
