import test from "node:test";
import assert from "node:assert/strict";

import { esignConsentLine, esignConsentSections } from "./esign-consent.ts";

test("the e-sign consent tells the customer what ESIGN requires before they agree", () => {
  const text = esignConsentSections("Pacific Plains Electric")
    .map((section) => `${section.heading} ${section.body}`)
    .join(" ");
  // Paper copies, at no charge, and the choice to sign on paper instead.
  assert.match(text, /paper copy/i);
  assert.match(text, /no charge/i);
  assert.match(text, /sign on paper instead/i);
  // Withdrawing consent, and how.
  assert.match(text, /withdraw this consent/i);
  assert.match(text, /phone, text or email/i);
  // What it covers, including cancellation notices.
  assert.match(text, /right to cancel/i);
  // What they need to open and keep the records.
  assert.match(text, /PDF/);
  // Keeping contact details current.
  assert.match(text, /email address or phone number changes/i);
  assert.match(text, /Pacific Plains Electric/);
});

test("the checkbox line names what is being signed and that the signature counts as by hand", () => {
  assert.match(esignConsentLine("change order"), /sign this change order electronically/);
  assert.match(esignConsentLine("contract"), /same as signing by hand/);
});
