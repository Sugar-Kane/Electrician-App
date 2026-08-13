import test from "node:test";
import assert from "node:assert/strict";

import { bodyProvidesSignatures } from "./contract-signatures.ts";

test("a template that ends with its own signing lines is recognised", () => {
  const body = [
    "PRICE",
    "Total: $4,280.00",
    "",
    "Customer signature: ______________________  Date: ____________",
    "",
    "Pacific Plains Electric representative: ______________________  Date: ____________",
  ].join("\n");

  assert.equal(bodyProvidesSignatures(body), true);
});

test("a signing line with the rule on the line below still counts", () => {
  // The other half of the templates in the wild are laid out this way.
  const body = ["IN WITNESS WHEREOF", "", "Signed by the undersigned:", "", "____________________"].join(
    "\n",
  );

  assert.equal(bodyProvidesSignatures(body), true);
});

test("a contract that only mentions signing has nowhere to sign", () => {
  // The case that matters most. Reading this as "already has signatures" would
  // print a contract with no signature block at all.
  const body = [
    "SCOPE OF WORK",
    "Replace the main panel.",
    "",
    "No work begins before this agreement is signed by both parties.",
  ].join("\n");

  assert.equal(bodyProvidesSignatures(body), false);
});

test("a row of underscores used as a divider is not a signing line", () => {
  const body = [
    "This agreement is signed by both parties.",
    "",
    "________________________________________",
    "",
    "TERMS",
  ].join("\n");

  // The word and the rule are three lines apart, which is a divider under a
  // heading rather than a space left for a pen.
  assert.equal(bodyProvidesSignatures(body), false);
});

test("a contract with no signing language at all gets the document's block", () => {
  assert.equal(bodyProvidesSignatures("SCOPE OF WORK\nReplace the main panel."), false);
  assert.equal(bodyProvidesSignatures(""), false);
});

test("windows line endings do not hide the signing line", () => {
  const body = "Customer signature:\r\n______________________\r\n";
  assert.equal(bodyProvidesSignatures(body), true);
});
