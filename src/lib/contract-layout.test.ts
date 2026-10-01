import test from "node:test";
import assert from "node:assert/strict";

import { contractBlocks, looksLikeHeading } from "./contract-layout.ts";

test("a short all-caps line is a heading", () => {
  assert.equal(looksLikeHeading("WORK AGREEMENT"), true);
  assert.equal(looksLikeHeading("Payment terms:"), true);
});

test("a sentence is not a heading, however it is cased", () => {
  assert.equal(looksLikeHeading("THE BALANCE IS DUE ON COMPLETION."), false);
  assert.equal(looksLikeHeading("The balance is due on completion"), false);
  assert.equal(looksLikeHeading(""), false);
  assert.equal(looksLikeHeading("A".repeat(61)), false);
});

test("the body splits on blank lines, Windows line endings included", () => {
  // The shape of a template pasted from Word, as job #15's was.
  const body = "WORK AGREEMENT\r\n\r\nThis agreement is made on Wed, Sep 30.\r\n\r\n\r\nPRICE\r\nTotal: $180.00";
  assert.deepEqual(contractBlocks(body), [
    { text: "WORK AGREEMENT", heading: true },
    { text: "This agreement is made on Wed, Sep 30.", heading: false },
    // A heading line that leads its own paragraph stays part of it, as the
    // PDF has always set it.
    { text: "PRICE\nTotal: $180.00", heading: false },
  ]);
});

test("an empty body has no blocks", () => {
  assert.deepEqual(contractBlocks(""), []);
  assert.deepEqual(contractBlocks("\n\n  \n\n"), []);
});
