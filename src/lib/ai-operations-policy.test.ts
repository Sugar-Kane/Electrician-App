import assert from "node:assert/strict";
import { test } from "node:test";

import { canViewAiOperations } from "./ai-operations-policy.ts";

test("only organization decision makers may review AI operational activity", () => {
  assert.equal(canViewAiOperations("owner"), true);
  assert.equal(canViewAiOperations("admin"), true);
  for (const role of ["technician", "member", "viewer", "", "platform_admin"]) {
    assert.equal(canViewAiOperations(role), false, role);
  }
});
