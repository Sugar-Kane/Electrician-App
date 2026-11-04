import assert from "node:assert/strict";
import { test } from "node:test";

import { aiUseAllowed, DEFAULT_MONTHLY_AI_USES, monthlyAiLimit, monthStart } from "./ai-allowance-rules.ts";

test("uses are allowed up to the limit and refused at it", () => {
  assert.equal(aiUseAllowed(0, 200), true);
  assert.equal(aiUseAllowed(199, 200), true);
  assert.equal(aiUseAllowed(200, 200), false);
  assert.equal(aiUseAllowed(350, 200), false);
});

test("a limit of zero turns the built-in AI off", () => {
  assert.equal(aiUseAllowed(0, 0), false);
  assert.equal(monthlyAiLimit("0"), 0);
});

test("an unset or unreadable limit falls back to the default", () => {
  assert.equal(monthlyAiLimit(undefined), DEFAULT_MONTHLY_AI_USES);
  assert.equal(monthlyAiLimit(""), DEFAULT_MONTHLY_AI_USES);
  assert.equal(monthlyAiLimit("lots"), DEFAULT_MONTHLY_AI_USES);
  assert.equal(monthlyAiLimit("-5"), DEFAULT_MONTHLY_AI_USES);
  assert.equal(monthlyAiLimit("12.5"), DEFAULT_MONTHLY_AI_USES);
  assert.equal(monthlyAiLimit(" 50 "), 50);
});

test("the month starts on the 1st at midnight UTC", () => {
  assert.equal(monthStart(new Date("2026-11-30T23:59:00Z")).toISOString(), "2026-11-01T00:00:00.000Z");
  assert.equal(monthStart(new Date("2027-01-01T00:00:00Z")).toISOString(), "2027-01-01T00:00:00.000Z");
});
