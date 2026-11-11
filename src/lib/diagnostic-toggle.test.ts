import test from "node:test";
import assert from "node:assert/strict";

import { STANDARD_DIAGNOSTIC_FEE_CENTS, diagnosticFeeChange, type DiagnosticFeeState } from "./diagnostic-toggle.ts";

const job = (overrides: Partial<DiagnosticFeeState> = {}): DiagnosticFeeState => ({
  feeCents: 18_000,
  paid: false,
  followUp: false,
  canceled: false,
  ...overrides,
});

test("turning the fee off saves zero", () => {
  assert.deepEqual(diagnosticFeeChange(job(), false, 18_000), { feeCents: 0 });
});

test("turning it back on uses the business's own fee", () => {
  assert.deepEqual(diagnosticFeeChange(job({ feeCents: 0 }), true, 15_000), { feeCents: 15_000 });
});

test("with no business fee set, the standard fee is used", () => {
  assert.deepEqual(diagnosticFeeChange(job({ feeCents: 0 }), true, null), { feeCents: STANDARD_DIAGNOSTIC_FEE_CENTS });
  assert.deepEqual(diagnosticFeeChange(job({ feeCents: 0 }), true, 0), { feeCents: STANDARD_DIAGNOSTIC_FEE_CENTS });
});

test("a fee already on stays as it is when turned on again", () => {
  assert.deepEqual(diagnosticFeeChange(job({ feeCents: 9_500 }), true, 18_000), { feeCents: 9_500 });
});

test("a paid fee cannot be turned off", () => {
  assert.ok("error" in diagnosticFeeChange(job({ paid: true }), false, 18_000));
});

test("a follow-up has no fee of its own to change", () => {
  assert.ok("error" in diagnosticFeeChange(job({ followUp: true, feeCents: 0 }), true, 18_000));
});

test("a canceled job cannot change", () => {
  assert.ok("error" in diagnosticFeeChange(job({ canceled: true }), false, 18_000));
});
