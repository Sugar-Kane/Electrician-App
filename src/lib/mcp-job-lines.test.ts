import assert from "node:assert/strict";
import { test } from "node:test";

import { MAX_TOOL_LINES, readToolLines } from "./mcp-job-lines.ts";

test("a line without a customer price is refused, not billed as nothing", () => {
  const reading = readToolLines([{ description: "20A breaker", quantity: 2 }]);
  assert.equal(reading.ok, false);
});

test("zero is a real price: no charge", () => {
  const reading = readToolLines([{ description: "Wire nuts", quantity: 10, unit_price: 0 }]);
  assert.ok(reading.ok);
  assert.equal(reading.rows[0].unit_price_cents, 0);
  assert.equal(reading.totalCents, 0);
});

test("prices typed as text or numbers come out in cents and total up", () => {
  const reading = readToolLines([
    { description: "20A breaker", quantity: "2", unit_price: "$18.50" },
    { description: "Labor", kind: "labor", quantity: 1.5, unit_price: 125 },
  ]);
  assert.ok(reading.ok);
  assert.deepEqual(
    reading.rows.map((row) => [row.kind, row.unit, row.unit_price_cents]),
    [
      ["material", "each", 1850],
      ["labor", "hr", 12500],
    ],
  );
  assert.equal(reading.totalCents, 3700 + 18750);
});

test("an unreadable price or quantity is refused rather than guessed", () => {
  assert.equal(readToolLines([{ description: "Panel", quantity: 1, unit_price: "about 900" }]).ok, false);
  assert.equal(readToolLines([{ description: "Panel", quantity: "some", unit_price: 900 }]).ok, false);
  assert.equal(readToolLines([{ description: "Panel", quantity: -1, unit_price: 900 }]).ok, false);
});

test("a missing quantity is one, and an unknown unit is each", () => {
  const reading = readToolLines([{ description: "Panel", unit: "pallet", unit_price: 900 }]);
  assert.ok(reading.ok);
  assert.equal(reading.rows[0].quantity, 1);
  assert.equal(reading.rows[0].unit, "each");
});

test("empty and oversized lists are refused", () => {
  assert.equal(readToolLines([]).ok, false);
  assert.equal(readToolLines("not a list").ok, false);
  const many = Array.from({ length: MAX_TOOL_LINES + 1 }, () => ({ description: "Part", unit_price: 1 }));
  assert.equal(readToolLines(many).ok, false);
});
