import test from "node:test";
import assert from "node:assert/strict";

import {
  MOVEMENT_REASONS,
  adjustmentTo,
  isMovementReason,
  movementLabel,
  onHand,
  parseMovementQuantity,
  purchasedCents,
  signedQuantity,
  spentCents,
  type Movement,
} from "./inventory-movement.ts";

test("twenty in, three out, seventeen on hand", () => {
  // The whole feature in one line.
  const movements = [{ quantity: 20 }, { quantity: -3 }];
  assert.equal(onHand(movements), 17);
});

test("a hundred movements do not drift", () => {
  // A tenth of a foot of wire, a hundred times, is ten feet — not
  // 9.999999999999998 feet.
  const movements = Array.from({ length: 100 }, () => ({ quantity: 0.1 }));
  assert.equal(onHand(movements), 10);
});

test("a reason that only goes one way has its sign applied for it", () => {
  // "Used on a job, 3" means three fewer, whatever sign the caller passed.
  assert.equal(signedQuantity("used_on_job", 3), -3);
  assert.equal(signedQuantity("used_on_job", -3), -3);
  assert.equal(signedQuantity("wastage", 2), -2);

  assert.equal(signedQuantity("received", 20), 20);
  assert.equal(signedQuantity("received", -20), 20);
  assert.equal(signedQuantity("returned", 1), 1);
});

test("the two reasons that genuinely go either way keep their sign", () => {
  assert.equal(signedQuantity("adjustment", -4), -4);
  assert.equal(signedQuantity("adjustment", 4), 4);
  assert.equal(signedQuantity("stock_take", -1), -1);
});

test("a stock take is typed as what was counted, not as the difference", () => {
  // Asking somebody in a van to subtract is how a count of 17 becomes an
  // adjustment of 17 on top of the 20 already there.
  assert.equal(adjustmentTo(17, 20), -3);
  assert.equal(adjustmentTo(25, 20), 5);
  // A count that agrees writes nothing at all.
  assert.equal(adjustmentTo(20, 20), null);
  assert.equal(adjustmentTo(0.3, 0.1), 0.2);
});

test("what left, at what it cost, is the material spend", () => {
  const movements: Movement[] = [
    { quantity: 20, reason: "received", unitCostCents: 3800 },
    { quantity: -3, reason: "used_on_job", unitCostCents: 3800 },
  ];
  // Three breakers at $38.
  assert.equal(spentCents(movements), 11_400);
});

test("a part bought cheap and used later is the expense it was, not today's price", () => {
  const movements: Movement[] = [
    { quantity: 10, reason: "received", unitCostCents: 3800 },
    { quantity: -2, reason: "used_on_job", unitCostCents: 3800 },
    // The price went up before the next lot came in.
    { quantity: 10, reason: "received", unitCostCents: 4500 },
    { quantity: -2, reason: "used_on_job", unitCostCents: 4500 },
  ];
  assert.equal(spentCents(movements), 2 * 3800 + 2 * 4500);
});

test("a return to stock reduces the spend rather than becoming income", () => {
  const movements: Movement[] = [
    { quantity: -3, reason: "used_on_job", unitCostCents: 3800 },
    { quantity: 3, reason: "returned", unitCostCents: 3800 },
  ];
  // Nothing was consumed, so nothing was spent — and it never goes negative.
  assert.equal(spentCents(movements), 11_400);
  assert.ok(spentCents([{ quantity: 5, reason: "returned", unitCostCents: 100 }]) >= 0);
});

test("the opening count is stock already owned, not a purchase", () => {
  // Counting it would put a whole van's worth into one day's expenses.
  const movements: Movement[] = [
    { quantity: 40, reason: "opening", unitCostCents: 3800 },
    { quantity: 10, reason: "received", unitCostCents: 3800 },
  ];
  assert.equal(purchasedCents(movements), 38_000);
});

test("a quantity that cannot be read is refused rather than silently nothing", () => {
  assert.equal(parseMovementQuantity("3"), 3);
  assert.equal(parseMovementQuantity("1,200"), 1200);
  assert.equal(parseMovementQuantity("-2"), -2);
  assert.equal(parseMovementQuantity("0.5"), 0.5);

  assert.equal(parseMovementQuantity(""), null);
  assert.equal(parseMovementQuantity("   "), null);
  assert.equal(parseMovementQuantity("a few"), null);
  // Zero is not a movement. The database refuses it too.
  assert.equal(parseMovementQuantity("0"), null);
  assert.equal(parseMovementQuantity("0.001"), null);
});

test("every reason the database accepts has a label and a direction", () => {
  for (const reason of MOVEMENT_REASONS) {
    assert.ok(isMovementReason(reason.value), reason.value);
    assert.ok(reason.label.trim().length > 0, reason.value);
    assert.ok(["in", "out", "either"].includes(reason.direction), reason.value);
    assert.equal(movementLabel(reason.value), reason.label);
  }

  assert.equal(isMovementReason("stolen"), false);
  // Something unknown still reads as words rather than as a column name.
  assert.equal(movementLabel("stolen"), "Moved");
});
