import test from "node:test";
import assert from "node:assert/strict";

import {
  freeQuantity,
  packLabel,
  reservedByItem,
  reservedQuantity,
  stockQuantity,
  stockSummary,
  takenByLine,
  usageMovements,
  usedSentence,
  type StockLine,
} from "./stock-reservation.ts";
import { lineCostCents, partsCost, readPrice } from "./job-lines.ts";

const line = (overrides: Partial<StockLine>): StockLine => ({
  lineId: "l1",
  itemId: "breaker",
  quantity: 3,
  open: true,
  taken: 0,
  ...overrides,
});

test("a part on an open job reserves what it asked for, and takes nothing", () => {
  assert.equal(reservedQuantity(line({})), 3);
});

test("a line written before reservations took its parts already, so it reserves nothing", () => {
  assert.equal(reservedQuantity(line({ taken: 3 })), 0);
});

test("a line that took some reserves the rest", () => {
  assert.equal(reservedQuantity(line({ quantity: 5, taken: 2 })), 3);
});

test("a finished or canceled job reserves nothing", () => {
  assert.equal(reservedQuantity(line({ open: false })), 0);
});

test("reservations add up per item, and free is on hand less reserved", () => {
  const reserved = reservedByItem([
    line({ lineId: "a", quantity: 3 }),
    line({ lineId: "b", quantity: 1.5 }),
    line({ lineId: "c", itemId: "wire", quantity: 50 }),
    line({ lineId: "d", quantity: 4, open: false }),
  ]);
  assert.equal(reserved.get("breaker"), 4.5);
  assert.equal(reserved.get("wire"), 50);
  assert.equal(freeQuantity(20, reserved.get("breaker") ?? 0), 15.5);
  assert.equal(stockSummary(20, 4.5), "20 on hand · 4.5 reserved · 15.5 free");
  assert.equal(stockSummary(20, 0, "ft"), "20 ft on hand");
});

test("more promised than owned reads below zero, not as zero", () => {
  assert.equal(freeQuantity(2, 5), -3);
});

test("the ledger nets what each line took: used, then partly returned", () => {
  const taken = takenByLine([
    { lineId: "a", quantity: -3 },
    { lineId: "a", quantity: 1 },
    { lineId: "b", quantity: -2 },
    { lineId: "b", quantity: 2 },
  ]);
  assert.equal(taken.get("a"), 2);
  assert.equal(taken.get("b"), 0);
});

test("finishing a job uses what was reserved unless somebody said otherwise", () => {
  const lines = [line({ lineId: "a" }), line({ lineId: "b", itemId: "wire", quantity: 50 }), line({ lineId: "c", quantity: 2 })];
  const moves = usageMovements(lines, new Map([["b", 30], ["c", 0]]));
  assert.deepEqual(moves, [
    { lineId: "a", itemId: "breaker", quantity: 3 },
    { lineId: "b", itemId: "wire", quantity: 30 },
  ]);
});

test("a nonsense or negative count takes nothing, and more than reserved is allowed", () => {
  const lines = [line({ lineId: "a" }), line({ lineId: "b" })];
  assert.deepEqual(usageMovements(lines, new Map([["a", Number.NaN], ["b", -2]])), []);
  assert.deepEqual(usageMovements([line({ lineId: "a" })], new Map([["a", 4]])), [
    { lineId: "a", itemId: "breaker", quantity: 4 },
  ]);
});

test("a line that already took its parts writes nothing more at completion", () => {
  assert.deepEqual(usageMovements([line({ taken: 3 })]), []);
});

test("confirming the same usage twice takes the parts once", () => {
  const confirmed = new Map([["l1", 2]]);
  assert.deepEqual(usageMovements([line({})], confirmed), [{ lineId: "l1", itemId: "breaker", quantity: 2 }]);
  // The retry sees the 2 already taken.
  assert.deepEqual(usageMovements([line({ taken: 2 })], confirmed), []);
  // Saying 3 after 2 were taken takes the one more.
  assert.deepEqual(usageMovements([line({ taken: 2 })], new Map([["l1", 3]])), [
    { lineId: "l1", itemId: "breaker", quantity: 1 },
  ]);
});

test("the used sentence names what is left, and a count below zero asks for a recount", () => {
  assert.equal(usedSentence(2, 18), "Used 2 from stock, 18 left.");
  assert.equal(usedSentence(30, 220, "ft"), "Used 30 ft from stock, 220 ft left.");
  assert.equal(usedSentence(3, -1), "Used 3 from stock, the count now shows -1, so recount it.");
});

test("ten 10-foot sticks are written out as 100 ft and take 100 ft of conduit counted in feet", () => {
  const sticks = { quantity: 10, unit: "stick", packSize: 10, packUnit: "ft" };
  assert.equal(packLabel(sticks), "10 sticks × 10 ft = 100 ft");
  assert.equal(stockQuantity(sticks, "ft"), 100);
  assert.equal(stockQuantity({ quantity: 100, unit: "ft" }, "ft"), 100);
  // Counted in sticks, a stick is a stick.
  assert.equal(stockQuantity(sticks, "stick"), 10);
});

test("a pack with no size given is not converted or labelled", () => {
  const box = { quantity: 2, unit: "box", packSize: null, packUnit: null };
  assert.equal(packLabel(box), "");
  assert.equal(stockQuantity(box, "each"), 2);
  assert.equal(packLabel({ quantity: 1, unit: "box", packSize: 25, packUnit: "each" }), "1 box × 25 each = 25 each");
});

test("a blank price is missing, zero is a price, and junk is refused", () => {
  assert.deepEqual(readPrice(""), { state: "missing" });
  assert.deepEqual(readPrice("   "), { state: "missing" });
  assert.deepEqual(readPrice("0"), { state: "set", cents: 0 });
  assert.deepEqual(readPrice("$12.50"), { state: "set", cents: 1250 });
  assert.deepEqual(readPrice("12.505"), { state: "invalid" });
});

test("a part's cost is unknown until recorded, and the job's cost says how many are unknown", () => {
  assert.equal(lineCostCents({ quantity: 3, unitCostCents: null }), null);
  assert.equal(lineCostCents({ quantity: 3, unitCostCents: 0 }), 0);
  assert.equal(lineCostCents({ quantity: 1.5, unitCostCents: 999 }), 1499);
  assert.deepEqual(
    partsCost([
      { kind: "material", quantity: 2, unitCostCents: 420 },
      { kind: "material", quantity: 1, unitCostCents: null },
      { kind: "labor", quantity: 3, unitCostCents: null },
    ]),
    { knownCents: 840, unknownCount: 1 },
  );
});
