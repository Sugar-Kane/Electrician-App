import test from "node:test";
import assert from "node:assert/strict";

import { maskBody, maskContacts, maskEmail, maskPhone } from "./admin-mask.ts";

test("a phone number shows only its last four digits", () => {
  assert.equal(maskPhone("(805) 555-0142"), "••• 0142");
  assert.equal(maskPhone("+18055550142"), "••• 0142");
  assert.equal(maskPhone(""), "");
  assert.equal(maskPhone(null), "");
});

test("an email shows its first letter and domain, never the name", () => {
  assert.equal(maskEmail("sarah.jones@example.com"), "s•••@example.com");
  assert.equal(maskEmail("not-an-address"), "•••");
  assert.equal(maskEmail(""), "");
});

test("a text's words are hidden, its length is not", () => {
  assert.equal(maskBody("Running 10 minutes late"), "Hidden · 23 characters");
  assert.equal(maskBody(""), "Empty");
});

test("contacts inside free text are hidden and the rest is kept", () => {
  const masked = maskContacts("BOOKED for Sarah at 805-555-0142, confirm to sarah@example.com. Job 1042.");
  assert.equal(masked, "BOOKED for Sarah at ••• 0142, confirm to s•••@example.com. Job 1042.");
  // Short numbers are job numbers, times and amounts, not phone numbers.
  assert.equal(maskContacts("Slot 9:00-11:00, $180, job 1042"), "Slot 9:00-11:00, $180, job 1042");
});
