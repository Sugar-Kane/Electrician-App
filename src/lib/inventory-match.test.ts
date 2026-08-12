import test from "node:test";
import assert from "node:assert/strict";

import {
  describeCoverage,
  findStock,
  matchMaterials,
  nameSimilarity,
  nameTokens,
  normalizeName,
  type RequiredMaterial,
  type StockItem,
} from "./inventory-match.ts";

const item = (over: Partial<StockItem> & { id: string; name: string }): StockItem => ({
  quantity: 10,
  unit: "each",
  ...over,
});

const need = (name: string, quantity: number, unit = "each"): RequiredMaterial => ({
  name,
  quantity,
  unit,
});

test("amp, volt and foot spellings are the same part", () => {
  // The person listing the job and the person stocking the van are two people
  // writing at two different times.
  assert.equal(normalizeName("20A AFCI breaker"), normalizeName("20 amp AFCI breaker"));
  assert.equal(normalizeName("20-amp breaker"), normalizeName("20amp breaker"));
  assert.equal(normalizeName("120V receptacle"), normalizeName("120 volt receptacle"));
  assert.equal(normalizeName("50 ft cable"), normalizeName("50ft cable"));
});

test("punctuation and case do not make a different part", () => {
  assert.equal(
    normalizeName("AFCI Breaker, 20 amp (Square-D)"),
    "afci breaker 20amp square d",
  );
});

test("plurals and filler words are dropped", () => {
  assert.deepEqual(nameTokens("boxes of breakers"), ["boxe", "breaker"]);
  assert.ok(!nameTokens("a box for the panel").includes("the"));
});

test("a more specific stock name still matches the required part", () => {
  // The brand on the stock record does not make it a different breaker.
  assert.equal(nameSimilarity("AFCI breaker 20A", "20 amp AFCI breaker, Square D"), 1);
});

test("different parts do not match", () => {
  assert.ok(nameSimilarity("20A AFCI breaker", "200A main breaker panel") < 0.8);
  assert.ok(nameSimilarity("6/3 NM-B cable", "0-10V dimmer switch") < 0.5);
  assert.equal(nameSimilarity("", "anything"), 0);
});

test("a part number is an identity and beats the name", () => {
  const stock = [
    item({ id: "wrong", name: "20 amp AFCI breaker" }),
    item({ id: "right", name: "Something typed badly", partNumber: "HOM120AFIC" }),
  ];

  const match = findStock(need("Breaker HOM120AFIC", 1), stock);
  assert.equal(match?.id, "right");
});

test("a required line with stock is marked covered", () => {
  const matched = matchMaterials(
    [need("20A AFCI breaker", 2)],
    [item({ id: "a", name: "AFCI breaker 20 amp", quantity: 4 })],
  );

  assert.equal(matched[0]!.inStock, 2);
  assert.equal(matched[0]!.shortfall, 0);
  assert.equal(matched[0]!.stock?.id, "a");
});

test("partial stock reports the exact shortfall", () => {
  // "You have one, buy two" is the answer somebody standing in an aisle needs.
  const matched = matchMaterials(
    [need("20A AFCI breaker", 3)],
    [item({ id: "a", name: "AFCI breaker 20 amp", quantity: 1 })],
  );

  assert.equal(matched[0]!.inStock, 1);
  assert.equal(matched[0]!.shortfall, 2);
});

test("nothing in stock is the whole quantity to buy", () => {
  const matched = matchMaterials([need("200A main panel", 1)], []);

  assert.equal(matched[0]!.inStock, 0);
  assert.equal(matched[0]!.shortfall, 1);
  assert.equal(matched[0]!.stock, undefined);
});

test("two lines needing the same part do not both claim it", () => {
  // The bug this prevents: four breakers covering a job that needs six,
  // because two separate lines each looked at the same stock row.
  const matched = matchMaterials(
    [need("20A AFCI breaker", 3), need("AFCI breaker 20 amp", 3)],
    [item({ id: "a", name: "20 amp AFCI breaker", quantity: 4 })],
  );

  assert.equal(matched[0]!.inStock, 3);
  assert.equal(matched[0]!.shortfall, 0);
  assert.equal(matched[1]!.inStock, 1);
  assert.equal(matched[1]!.shortfall, 2);
});

test("a unit mismatch is treated as no match rather than converted", () => {
  // Fifty feet of cable against a stock row counted in boxes is not something
  // that can be safely reconciled, and inventing a conversion would produce a
  // confident wrong answer.
  const matched = matchMaterials(
    [need("6/3 NM-B cable", 50, "ft")],
    [item({ id: "a", name: "6/3 NM-B cable", quantity: 3, unit: "box" })],
  );

  assert.equal(matched[0]!.inStock, 0);
  assert.equal(matched[0]!.shortfall, 50);
});

test("a wrong match never claims stock the business does not have", () => {
  // The failure that matters: "you have it" is believed, and somebody drives
  // to a job without the part.
  const matched = matchMaterials(
    [need("200A main breaker panel", 1)],
    [item({ id: "a", name: "20A AFCI breaker", quantity: 40 })],
  );

  assert.equal(matched[0]!.inStock, 0);
  assert.equal(matched[0]!.shortfall, 1);
});

test("nonsense quantities do not become negative shortfalls", () => {
  const matched = matchMaterials(
    [{ name: "cable", quantity: Number.NaN, unit: "ft" }],
    [item({ id: "a", name: "cable", quantity: 5, unit: "ft" })],
  );

  assert.equal(matched[0]!.shortfall, 0);
  assert.ok(matched[0]!.inStock >= 0);
});

test("the summary says what to do, not what was computed", () => {
  const covered = matchMaterials(
    [need("20A AFCI breaker", 1)],
    [item({ id: "a", name: "20 amp AFCI breaker", quantity: 5 })],
  );
  assert.match(describeCoverage(covered), /no supply stop needed/);

  const none = matchMaterials([need("200A panel", 1)], []);
  assert.match(describeCoverage(none), /None of these/);

  const mixed = matchMaterials(
    [need("20A AFCI breaker", 1), need("200A panel", 1)],
    [item({ id: "a", name: "20 amp AFCI breaker", quantity: 5 })],
  );
  assert.match(describeCoverage(mixed), /1 of 2 covered/);

  assert.match(describeCoverage([]), /Nothing is needed/);
});
