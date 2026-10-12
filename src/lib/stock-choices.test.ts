import test from "node:test";
import assert from "node:assert/strict";

import { findStockChoices, stockChoiceDetail, stockReservedNote, stockShortfall, type StockChoice } from "./stock-choices.ts";

const item = (overrides: Partial<StockChoice>): StockChoice => ({
  id: overrides.name ?? "x",
  name: "Part",
  partNumber: "",
  unit: "each",
  unitCostCents: 0,
  quantityOnHand: 0,
  location: "",
  ...overrides,
});

const stock = [
  item({ name: "Leviton 20A tamper-resistant GFCI receptacle, white", partNumber: "TR-GFCI", quantityOnHand: 2, location: "Van — bin 1" }),
  item({ name: "Romex 12/2 NM-B with ground, 250 ft", partNumber: "12-2-NMB-250", unit: "roll", quantityOnHand: 1, location: "Shop shelf A" }),
  item({ name: "Square D QO 20A single-pole breaker", partNumber: "QO120", quantityOnHand: 6, location: "Van — bin 3" }),
];
const names = (found: StockChoice[]) => found.map((choice) => choice.name.split(" ").slice(0, 2).join(" "));

test("with nothing typed, the whole shelf", () => {
  assert.deepEqual(names(findStockChoices(stock, "")), ["Leviton 20A", "Romex 12/2", "Square D"]);
  assert.deepEqual(names(findStockChoices(stock, "   ")), ["Leviton 20A", "Romex 12/2", "Square D"]);
});

test("found by name, part number or where it lives", () => {
  assert.deepEqual(names(findStockChoices(stock, "breaker")), ["Square D"]);
  assert.deepEqual(names(findStockChoices(stock, "qo120")), ["Square D"]);
  assert.deepEqual(names(findStockChoices(stock, "bin 1")), ["Leviton 20A"]);
  assert.deepEqual(names(findStockChoices(stock, "shelf")), ["Romex 12/2"]);
});

test("searched the way the Stock page searches: 20 amp is 20A", () => {
  assert.deepEqual(names(findStockChoices(stock, "20 amp")), ["Leviton 20A", "Square D"]);
  assert.deepEqual(names(findStockChoices(stock, "12-2")), ["Romex 12/2"]);
});

test("nothing matching finds nothing", () => {
  assert.deepEqual(findStockChoices(stock, "conduit"), []);
});

test("the line under a part says its number, how many and where", () => {
  assert.equal(stockChoiceDetail(stock[2]!), "QO120 · 6 on hand · Van — bin 3");
  assert.equal(stockChoiceDetail(item({ quantityOnHand: 12.5 })), "12.5 on hand");
  assert.equal(stockChoiceDetail(item({ quantityOnHand: 0, location: "Van" })), "None on hand · Van");
  assert.equal(stockChoiceDetail(item({ quantityOnHand: 6, reserved: 2 })), "6 on hand, 2 reserved");
});

test("adding a part reserves it: the note says what is still free, not what is left", () => {
  assert.equal(stockReservedNote(item({ quantityOnHand: 6, reserved: 2 })), "Reserved for this job. 4 of 6 still free.");
  assert.equal(stockReservedNote(item({ quantityOnHand: 2, reserved: 2 })), "Reserved for this job. 0 of 2 still free.");
  assert.equal(
    stockReservedNote(item({ quantityOnHand: 1, reserved: 2 })),
    "Reserved for this job, but that is 1 more than you have free. Recount it or buy more.",
  );
});

test("asking for more than is free is said, not refused", () => {
  assert.equal(stockShortfall(stock[2]!, 6), "");
  assert.equal(stockShortfall(stock[2]!, 2), "");
  assert.equal(stockShortfall(stock[1]!, 2), "Only 1 on hand. Reserving 2 promises more than you have.");
  assert.equal(stockShortfall(item({ quantityOnHand: 0 }), 1), "None on hand. Reserving it promises more than you have.");
  // Parts held for other jobs are not free.
  assert.equal(
    stockShortfall(item({ quantityOnHand: 6, reserved: 4 }), 3),
    "Only 2 free (6 on hand, 4 reserved). Reserving 3 promises more than you have.",
  );
  assert.equal(
    stockShortfall(item({ quantityOnHand: 3, reserved: 3 }), 1),
    "None free: all 3 on hand are reserved for other jobs. Reserving it promises more than you have.",
  );
  // An unreadable quantity is the form's to complain about, not this.
  assert.equal(stockShortfall(stock[1]!, null), "");
});
