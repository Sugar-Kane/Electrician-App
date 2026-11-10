import test from "node:test";
import assert from "node:assert/strict";

import { canEditBilling } from "./billing-permission.ts";

test("technicians change billing only while the owner allows it", () => {
  assert.equal(canEditBilling("technician", true), true);
  assert.equal(canEditBilling("technician", false), false);
});

test("every other role keeps billing whatever the setting", () => {
  for (const role of ["owner", "admin", "dispatcher", "accountant"]) {
    assert.equal(canEditBilling(role, false), true, role);
    assert.equal(canEditBilling(role, true), true, role);
  }
});

test("no role, no billing", () => {
  assert.equal(canEditBilling("", true), false);
});
