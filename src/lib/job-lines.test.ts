import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatCents,
  formatQuantity,
  jobLineTotals,
  lineTotalCents,
  parsePriceCents,
  parseQuantity,
  type JobLine,
} from "./job-lines.ts";

function line(overrides: Partial<JobLine> = {}): JobLine {
  return {
    id: "1",
    kind: "material",
    description: "20A AFCI breaker",
    quantity: 1,
    unit: "each",
    unitPriceCents: 5999,
    ...overrides,
  };
}

test("a line is quantity times price, in cents", () => {
  assert.equal(lineTotalCents({ quantity: 2, unitPriceCents: 5999 }), 11998);
});

test("a fractional cent price is a bug upstream, so it is squared up on arrival", () => {
  // The column is an integer. 1999.5 cannot come from the database.
  assert.equal(lineTotalCents({ quantity: 3, unitPriceCents: 1999.5 }), 6000);
});

test("a fractional quantity rounds the product, not the price", () => {
  // 1.5 × $9.99 is $14.985, and somebody has to decide which cent that is.
  assert.equal(lineTotalCents({ quantity: 1.5, unitPriceCents: 999 }), 1499);
});

test("a quarter hour of labour bills a quarter of the rate", () => {
  assert.equal(lineTotalCents({ quantity: 1.5, unitPriceCents: 12000 }), 18000);
});

test("an unreadable quantity is worth nothing, not one", () => {
  assert.equal(lineTotalCents({ quantity: Number.NaN, unitPriceCents: 90000 }), 0);
  assert.equal(lineTotalCents({ quantity: 0, unitPriceCents: 90000 }), 0);
});

test("a negative price cannot credit a job", () => {
  assert.equal(lineTotalCents({ quantity: 2, unitPriceCents: -5000 }), 0);
});

test("labour and materials are summed apart and together", () => {
  const totals = jobLineTotals([
    line({ id: "a", kind: "labour", description: "Diagnosis", quantity: 1.5, unit: "hr", unitPriceCents: 12000 }),
    line({ id: "b", kind: "material", quantity: 2, unitPriceCents: 5999 }),
    line({ id: "c", kind: "material", description: "Wire", quantity: 30, unit: "ft", unitPriceCents: 145 }),
  ]);

  assert.equal(totals.labourCents, 18000);
  assert.equal(totals.materialCents, 11998 + 4350);
  assert.equal(totals.subtotalCents, 18000 + 11998 + 4350);
  assert.equal(totals.lineCount, 3);
});

test("a job with no lines is worth zero, not undefined", () => {
  const totals = jobLineTotals([]);
  assert.equal(totals.subtotalCents, 0);
  assert.equal(totals.lineCount, 0);
});

test("a missing list does not throw", () => {
  const totals = jobLineTotals(undefined as unknown as JobLine[]);
  assert.equal(totals.subtotalCents, 0);
});

test("an unknown kind counts as a material rather than vanishing", () => {
  const totals = jobLineTotals([
    line({ kind: "supplies" as unknown as JobLine["kind"], quantity: 1, unitPriceCents: 1000 }),
  ]);
  assert.equal(totals.subtotalCents, 1000);
  assert.equal(totals.materialCents, 1000);
});

test("quantities are read the way they are typed", () => {
  assert.equal(parseQuantity("2"), 2);
  assert.equal(parseQuantity("1.5"), 1.5);
  assert.equal(parseQuantity(" 30 "), 30);
  // The unit gets typed into the quantity box because that is how it is said.
  assert.equal(parseQuantity("90 ft"), 90);
  assert.equal(parseQuantity("1 1/2"), 1.5);
  assert.equal(parseQuantity("3/4"), 0.75);
});

test("a quantity that cannot be read is refused, not guessed", () => {
  assert.equal(parseQuantity(""), null);
  assert.equal(parseQuantity("a few"), null);
  assert.equal(parseQuantity("0"), null);
  assert.equal(parseQuantity("-3"), null);
  assert.equal(parseQuantity("1/0"), null);
});

test("prices survive dollar signs and thousands separators", () => {
  assert.equal(parsePriceCents("$1,289.00"), 128900);
  assert.equal(parsePriceCents("1289"), 128900);
  assert.equal(parsePriceCents("59.99"), 5999);
  assert.equal(parsePriceCents("0"), 0);
});

test("a price that cannot be read is refused", () => {
  assert.equal(parsePriceCents(""), null);
  assert.equal(parsePriceCents("about ninety"), null);
  assert.equal(parsePriceCents("12.345"), null);
  assert.equal(parsePriceCents("-40"), null);
});

test("money reads as money and quantities lose their trailing zeros", () => {
  assert.equal(formatCents(128900), "$1,289.00");
  assert.equal(formatCents(0), "$0.00");
  assert.equal(formatQuantity(2), "2");
  assert.equal(formatQuantity(1.5), "1.5");
  assert.equal(formatQuantity(0), "0");
});
