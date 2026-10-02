import test from "node:test";
import assert from "node:assert/strict";

import { findStockChoices, stockChoiceDetail, stockLeft, stockShortfall, type StockChoice } from "./stock-choices.ts";

const item = (overrides: Partial<StockChoice>): StockChoice => ({
  id: overrides.name ?? "x",
  name: "Part",
  partNumber: "",
  unit: "each",
  unitPriceCents: 0,
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
});

test("what is left once a part is added", () => {
  assert.equal(stockLeft(item({ quantityOnHand: 4 })), "4 left in inventory.");
  assert.equal(stockLeft(item({ quantityOnHand: 0 })), "None left in inventory.");
  assert.equal(stockLeft(item({ quantityOnHand: -1 })), "Inventory now shows -1. Recount it when you can.");
});

test("taking more than the shelf has is said, not refused", () => {
  assert.equal(stockShortfall(stock[2]!, 6), "");
  assert.equal(stockShortfall(stock[2]!, 2), "");
  assert.equal(stockShortfall(stock[1]!, 2), "Only 1 on hand. Adding 2 takes the count below zero.");
  assert.equal(stockShortfall(item({ quantityOnHand: 0 }), 1), "None on hand. Adding it takes the count below zero.");
  // An unreadable quantity is the form's to complain about, not this.
  assert.equal(stockShortfall(stock[1]!, null), "");
});
