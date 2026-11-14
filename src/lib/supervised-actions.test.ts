import assert from "node:assert/strict";
import { test } from "node:test";

import {
  approverFor,
  classifyProviderError,
  enabledActionTypes,
  mayApprove,
  proposalView,
  retryDelaySeconds,
} from "./supervised-actions.ts";

test("binding and financial actions need the owner", () => {
  for (const action of ["send_contract", "send_estimate", "purchase_materials", "issue_refund", "change_price", "cancel_job"]) {
    assert.equal(mayApprove("owner", action, null), true, action);
    assert.equal(mayApprove("admin", action, null), false, action);
    assert.equal(mayApprove("technician", action, null), false, action);
  }
});

test("customer messages: templated by owner or admin, free-form by the owner only, never a technician", () => {
  assert.equal(mayApprove("admin", "send_customer_message", "invoice_overdue"), true);
  assert.equal(mayApprove("admin", "send_customer_message", null), false);
  assert.equal(mayApprove("owner", "send_customer_message", null), true);
  assert.equal(mayApprove("technician", "send_customer_message", "invoice_overdue"), false);
  assert.equal(mayApprove("dispatcher", "send_customer_email", "invoice_overdue"), false);
  assert.equal(mayApprove("admin", "add_job_note", null), true);
  assert.equal(mayApprove("accountant", "create_internal_task", null), false);
});

test("unknown actions and roles fail closed", () => {
  assert.equal(approverFor("wire_money", null), null);
  assert.equal(mayApprove("owner", "wire_money", null), false);
  assert.equal(mayApprove("", "send_customer_message", "invoice_overdue"), false);
  assert.equal(mayApprove("OWNER", "send_contract", null), false);
});

test("a timeout or server error is never read as failure", () => {
  assert.equal(classifyProviderError("network_error"), "uncertain");
  assert.equal(classifyProviderError(""), "uncertain");
  assert.equal(classifyProviderError("503"), "uncertain");
  assert.equal(classifyProviderError("internal_server_error"), "uncertain");
  assert.equal(classifyProviderError("429"), "retryable");
  assert.equal(classifyProviderError("rate_limit_exceeded"), "retryable");
  // Twilio: STOP list, bad number. Doing it again would not help.
  assert.equal(classifyProviderError("21610"), "failed");
  assert.equal(classifyProviderError("21211"), "failed");
  assert.equal(classifyProviderError("validation_error"), "failed");
});

test("retry backoff is bounded and matches the database", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 10].map(retryDelaySeconds), [30, 120, 480, 1920, 3600, 3600]);
});

test("the executor runs only action types the deployment names", () => {
  assert.deepEqual(enabledActionTypes(undefined), []);
  assert.deepEqual(enabledActionTypes(""), []);
  assert.deepEqual(enabledActionTypes("send_customer_message, wire_money ,add_job_note"), ["add_job_note", "send_customer_message"]);
  assert.equal(proposalView("../../etc"), "pending");
});
