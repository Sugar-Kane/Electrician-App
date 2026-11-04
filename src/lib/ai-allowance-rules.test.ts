import assert from "node:assert/strict";
import { test } from "node:test";

import { aiUseAllowed, DEFAULT_MONTHLY_AI_USES, monthlyAiLimit, monthStart, resolveAiLimit } from "./ai-allowance-rules.ts";

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

test("the paid plan and a platform override both mean unlimited", () => {
  assert.equal(resolveAiLimit({ subscriptionStatus: "active", businessLimit: 10 }), "unlimited");
  assert.equal(resolveAiLimit({ subscriptionStatus: "trialing" }), "unlimited");
  assert.equal(resolveAiLimit({ unlimited: true, businessLimit: 0 }), "unlimited");
  assert.equal(aiUseAllowed(100_000, "unlimited"), true);
});

test("a lapsed or unpaid subscription is not unlimited", () => {
  for (const status of ["past_due", "unpaid", "canceled", "incomplete", "paused", "", null]) {
    assert.equal(resolveAiLimit({ subscriptionStatus: status }), DEFAULT_MONTHLY_AI_USES, String(status));
  }
});

test("a business's own allowance beats the platform default, which beats the deployment's", () => {
  assert.equal(resolveAiLimit({ businessLimit: 50, platformDefault: 300, configured: "400" }), 50);
  assert.equal(resolveAiLimit({ businessLimit: 0, platformDefault: 300 }), 0);
  assert.equal(resolveAiLimit({ businessLimit: null, platformDefault: 300, configured: "400" }), 300);
  assert.equal(resolveAiLimit({ platformDefault: null, configured: "400" }), 400);
  assert.equal(resolveAiLimit({}), DEFAULT_MONTHLY_AI_USES);
});

test("a malformed stored allowance is ignored rather than trusted", () => {
  assert.equal(resolveAiLimit({ businessLimit: -3, platformDefault: 120 }), 120);
  assert.equal(resolveAiLimit({ businessLimit: 2.5 }), DEFAULT_MONTHLY_AI_USES);
});
