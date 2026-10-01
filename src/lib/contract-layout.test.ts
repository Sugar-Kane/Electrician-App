import test from "node:test";
import assert from "node:assert/strict";

import { contractBlocks, looksLikeHeading, signatureSection } from "./contract-layout.ts";

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

const business = "Pacific Plains Electric";
const owner = { name: "Nicholas Kane", title: "Owner", signedLabel: "Oct 1, 2026, 9:02 AM PDT" };
const customer = { name: "Adam", signedLabel: "Oct 1, 2026, 6:40 PM PDT" };

test("an unsigned contract invites both parties to sign", () => {
  assert.deepEqual(signatureSection({ ownSignatures: false, businessName: business }), {
    show: true,
    heading: "SIGNATURES",
    lines: ["By signing below both parties agree to the work and the price set out above."],
  });
});

test("once the business has signed, it says who signed for it and when", () => {
  const section = signatureSection({ ownSignatures: false, businessName: business, contractor: owner });
  assert.equal(section.show, true);
  assert.deepEqual(section.lines, [
    "By signing below both parties agree to the work and the price set out above.",
    "Signed for Pacific Plains Electric by Nicholas Kane, Owner on Oct 1, 2026, 9:02 AM PDT.",
  ]);
});

test("signed by both, it is the record of both, business first", () => {
  const section = signatureSection({ ownSignatures: false, businessName: business, contractor: owner, customer });
  assert.deepEqual(section.lines, [
    "Signed for Pacific Plains Electric by Nicholas Kane, Owner on Oct 1, 2026, 9:02 AM PDT.",
    "Signed electronically by Adam on Oct 1, 2026, 6:40 PM PDT.",
  ]);
});

test("a signer with no title is named without one", () => {
  const section = signatureSection({
    ownSignatures: false,
    businessName: business,
    contractor: { ...owner, title: "" },
  });
  assert.equal(section.lines[1], "Signed for Pacific Plains Electric by Nicholas Kane on Oct 1, 2026, 9:02 AM PDT.");
});

test("a template with its own signing lines gets no second block until somebody signs", () => {
  assert.equal(signatureSection({ ownSignatures: true, businessName: business }).show, false);

  // Signed by the business, it is the record of that — and does not offer the
  // customer a second place to sign.
  const signed = signatureSection({ ownSignatures: true, businessName: business, contractor: owner });
  assert.equal(signed.show, true);
  assert.equal(signed.heading, "SIGNED ELECTRONICALLY");
  assert.deepEqual(signed.lines, [
    "Signed for Pacific Plains Electric by Nicholas Kane, Owner on Oct 1, 2026, 9:02 AM PDT.",
  ]);
});
