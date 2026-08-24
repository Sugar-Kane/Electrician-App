import test from "node:test";
import assert from "node:assert/strict";

import { centsToInput, keepMoneyCharacters, keepQuantityCharacters } from "./money-input.ts";

test("letters and symbols never make it into a money box", () => {
  assert.equal(keepMoneyCharacters("about a grand"), "");
  assert.equal(keepMoneyCharacters("$1,280.00"), "1280.00");
  assert.equal(keepMoneyCharacters("1280 dollars"), "1280");
  assert.equal(keepMoneyCharacters("-500"), "500");
});

test("a repeated decimal point is harmless rather than fatal", () => {
  // The tap that used to lose somebody a whole form.
  assert.equal(keepMoneyCharacters("1280.."), "1280.");
  assert.equal(keepMoneyCharacters("12.80.50"), "12.80");
  assert.equal(keepMoneyCharacters("."), ".");
});

test("a number being typed is left alone while it is being typed", () => {
  // No separators appearing under the cursor, no "0." completing itself.
  assert.equal(keepMoneyCharacters("1"), "1");
  assert.equal(keepMoneyCharacters("12"), "12");
  assert.equal(keepMoneyCharacters("1280."), "1280.");
  assert.equal(keepMoneyCharacters("1000000"), "1000000");
});

test("a price stops at cents and a quantity does not", () => {
  assert.equal(keepMoneyCharacters("12.345"), "12.34");
  // Wire by the foot, time by the quarter hour.
  assert.equal(keepQuantityCharacters("12.345"), "12.345");
  assert.equal(keepQuantityCharacters("12.3456"), "12.345");
  assert.equal(keepQuantityCharacters("2 boxes"), "2");
});

test("cents go back into a box the way they came out", () => {
  assert.equal(centsToInput(128_000), "1280.00");
  assert.equal(centsToInput(99), "0.99");
  // Nothing, rather than a zero somebody has to delete before typing.
  assert.equal(centsToInput(0), "");
  assert.equal(centsToInput(Number.NaN), "");
});
