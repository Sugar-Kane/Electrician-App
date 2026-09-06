import assert from "node:assert/strict";
import test from "node:test";

import { webhookSecretMatches } from "./webhook-secret.ts";

test("webhook secrets require the exact non-empty value", () => {
  assert.equal(webhookSecretMatches("correct horse", "correct horse"), true);
  assert.equal(webhookSecretMatches("correct horse!", "correct horse"), false);
  assert.equal(webhookSecretMatches("wrong horse", "correct horse"), false);
  assert.equal(webhookSecretMatches(null, "correct horse"), false);
  assert.equal(webhookSecretMatches("", ""), false);
});
