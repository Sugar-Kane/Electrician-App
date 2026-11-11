import test from "node:test";
import assert from "node:assert/strict";

import { diagnosticFeeLineNeeded } from "./diagnostic-outcome.ts";

const job = (overrides: Partial<Parameters<typeof diagnosticFeeLineNeeded>[1]> = {}) => ({
  feeCents: 18_000,
  paid: false,
  followUpOf: null,
  hasFeeLine: false,
  ...overrides,
});

test("an unpaid diagnostic fee goes on the job whatever the outcome", () => {
  assert.equal(diagnosticFeeLineNeeded("diagnostic_only", job()), true);
  assert.equal(diagnosticFeeLineNeeded("fix_now", job()), true);
  assert.equal(diagnosticFeeLineNeeded("schedule_later", job()), true);
});

test("a fee paid at booking is not billed again for a diagnostic only or a later work order", () => {
  assert.equal(diagnosticFeeLineNeeded("diagnostic_only", job({ paid: true })), false);
  assert.equal(diagnosticFeeLineNeeded("schedule_later", job({ paid: true })), false);
});

test("fixing it now keeps the paid fee's line, so its credit never comes off the repair", () => {
  assert.equal(diagnosticFeeLineNeeded("fix_now", job({ paid: true })), true);
});

test("never a second fee line, none for a follow-up job, none when there is no fee", () => {
  assert.equal(diagnosticFeeLineNeeded("fix_now", job({ hasFeeLine: true })), false);
  assert.equal(diagnosticFeeLineNeeded("diagnostic_only", job({ followUpOf: "job-1" })), false);
  assert.equal(diagnosticFeeLineNeeded("fix_now", job({ feeCents: 0 })), false);
});
