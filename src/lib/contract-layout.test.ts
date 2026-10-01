import test from "node:test";
import assert from "node:assert/strict";

import { contractBlocks, looksLikeHeading, signatureSection, unwrapped } from "./contract-layout.ts";

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

test("a paragraph wrapped by hand flows as one", () => {
  // The starter template's paragraphs, which job #15's contract has.
  assert.equal(
    unwrapped(
      'This agreement is made on Thu, Oct 1, 2026 between Pacific Plains Electric ("the Contractor")\n' +
        'and Adam ("the Customer") for diagnostic work at\n' +
        "48 Pine St, Ventura, CA, 93003, booked as job 15 and scheduled for Fri, Oct 2, 2026.",
    ),
    'This agreement is made on Thu, Oct 1, 2026 between Pacific Plains Electric ("the Contractor") ' +
      'and Adam ("the Customer") for diagnostic work at ' +
      "48 Pine St, Ventura, CA, 93003, booked as job 15 and scheduled for Fri, Oct 2, 2026.",
  );
  assert.equal(
    unwrapped(
      "The price above covers the scope of work described. Work found to be necessary\n" +
        "beyond that scope will be quoted separately and will not begin without your\n" +
        "approval.",
    ),
    "The price above covers the scope of work described. Work found to be necessary " +
      "beyond that scope will be quoted separately and will not begin without your approval.",
  );
  assert.equal(
    unwrapped("Concealed conditions found once work has begun —\nexisting wiring that does not meet code"),
    "Concealed conditions found once work has begun — existing wiring that does not meet code",
  );
});

test("a line that is not a broken sentence keeps its own line", () => {
  for (const kept of [
    // A heading leading its paragraph, and lines of figures.
    "PRICE\nTotal: $180.00\nDeposit due before work begins: $180.00 (paid)",
    "SCOPE OF WORK\nan on-site diagnostic visit.",
    // Lists, and the line that leads into one.
    "The work includes:\nnew panel\ntwo circuits\nthe permit",
    "The work includes\n- a new panel\n- two circuits",
    "Steps\na) isolate the circuit\nb) replace the breaker",
    "Pay in two parts\n1. on booking\n2. on completion",
    // An address: a number after a name is not a sentence carrying on.
    "Pacific Plains Electric\n1420 Harvest Rd\nModesto, CA 95350",
    // A new sentence, or a name, on a line of its own.
    "The balance is due on completion.\nThe Customer agrees to provide access.",
  ]) {
    assert.equal(unwrapped(kept), kept);
  }
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
