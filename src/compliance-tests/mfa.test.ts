/** CT-MFA-001: who must use two-step sign-in, and when. */
import test from "node:test";
import assert from "node:assert/strict";

import { MFA_REQUIRED_FROM, mfaBlocks, mfaRequiredFor, mfaStep, readTotpCode } from "../lib/mfa-policy.ts";

const before = new Date("2026-12-09T12:00:00Z");
const after = new Date(MFA_REQUIRED_FROM);

test("CT-MFA-001: owners, admins and platform staff must use two-step sign-in from the deadline; anyone set up is always asked", () => {
  assert.equal(mfaRequiredFor({ role: "owner", platformAdmin: false }), true);
  assert.equal(mfaRequiredFor({ role: "admin", platformAdmin: false }), true);
  assert.equal(mfaRequiredFor({ role: "technician", platformAdmin: true }), true);
  assert.equal(mfaRequiredFor({ role: "technician", platformAdmin: false }), false);

  // Required, not set up: a reminder before the date, blocked from it.
  assert.equal(mfaStep({ required: true, aal: "aal1", hasFactor: false, now: before }), "enroll_soon");
  assert.equal(mfaStep({ required: true, aal: "aal1", hasFactor: false, now: after }), "enroll_now");
  // Set up: the code is asked for every sign-in, whoever they are and whatever the date.
  assert.equal(mfaStep({ required: true, aal: "aal1", hasFactor: true, now: before }), "verify");
  assert.equal(mfaStep({ required: false, aal: "aal1", hasFactor: true, now: before }), "verify");
  assert.equal(mfaStep({ required: true, aal: "aal2", hasFactor: true, now: after }), "none");
  // Not required: nothing to do.
  assert.equal(mfaStep({ required: false, aal: "aal1", hasFactor: false, now: after }), "none");

  assert.equal(mfaBlocks("verify"), true);
  assert.equal(mfaBlocks("enroll_now"), true);
  assert.equal(mfaBlocks("enroll_soon"), false);
  assert.equal(mfaBlocks("none"), false);
});

test("CT-MFA-001: a code is exactly six digits", () => {
  assert.equal(readTotpCode("123 456"), "123456");
  assert.equal(readTotpCode("12345"), null);
  assert.equal(readTotpCode("12345a"), null);
});
