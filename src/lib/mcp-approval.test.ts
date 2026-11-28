import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalArgs, approvalIdempotencyKey, awaitingApprovalText, needsVolteiraApproval, proposalFromPreview } from "./mcp-approval.ts";
import { mayApprove, mayApproveFromChatGpt } from "./supervised-actions.ts";

test("confirmed sends and money changes from ChatGPT wait for approval in Volteira", () => {
  for (const name of [
    "send_text", "send_estimate", "send_invoice", "send_contract_for_signature", "send_paid_invoice",
    "create_invoice", "bill_job", "mark_invoice_paid", "set_invoice_discount", "close_out_job",
    "prepare_supplier_order", "submit_supplier_order", "cancel_job",
  ]) {
    assert.equal(needsVolteiraApproval(name, { confirmed: true }), true, name);
    // Unconfirmed calls change nothing, so they are answered directly.
    assert.equal(needsVolteiraApproval(name, {}), false, name);
    assert.equal(needsVolteiraApproval(name, { confirmed: "true" }), false, name);
  }
});

test("rescheduling or a status step waits only when it tells the customer", () => {
  assert.equal(needsVolteiraApproval("reschedule_job", { confirmed: true, tell_customer: true }), true);
  assert.equal(needsVolteiraApproval("reschedule_job", { confirmed: true, tell_customer: false }), false);
  assert.equal(needsVolteiraApproval("update_job_status", { confirmed: true, step: "on_the_way" }), true);
  assert.equal(needsVolteiraApproval("update_job_status", { confirmed: true, step: "arrived" }), false);
});

test("internal edits keep the plain confirmation step", () => {
  for (const name of ["create_customer", "update_customer", "create_job", "add_job_lines", "save_job_scope", "save_materials_list", "set_business_hours", "draft_contract"]) {
    assert.equal(needsVolteiraApproval(name, { confirmed: true }), false, name);
  }
});

test("the proposal is read from the tool's own confirmation request, and nothing else", () => {
  assert.equal(
    proposalFromPreview("CONFIRMATION REQUIRED. Nothing was changed. Proposed action: Send invoice #12 by text."),
    "Send invoice #12 by text.",
  );
  assert.equal(
    proposalFromPreview("CONFIRMATION REQUIRED. Nothing was sent. Proposed action: Send the paid invoice #3."),
    "Send the paid invoice #3.",
  );
  assert.equal(proposalFromPreview("Invoice #12 was not found."), null);
  assert.equal(proposalFromPreview("Sent."), null);
});

test("the replayed arguments drop confirmed and are stable", () => {
  assert.deepEqual(approvalArgs({ confirmed: true, invoice_number: 12, channel: "sms" }), { channel: "sms", invoice_number: 12 });
  assert.equal(JSON.stringify(approvalArgs({ b: 1, a: 2, confirmed: true })), JSON.stringify(approvalArgs({ a: 2, confirmed: true, b: 1 })));
  const day = new Date("2026-11-26T10:00:00Z");
  assert.equal(approvalIdempotencyKey("cred", "send_invoice", "abc", day), "chatgpt-tool:cred:send_invoice:abc:2026-11-26");
});

test("ChatGPT is told nothing happened yet", () => {
  assert.match(awaitingApprovalText("Send invoice #12.", "pending"), /Nothing has been sent or changed yet/);
  assert.match(awaitingApprovalText("Send invoice #12.", "executed"), /already made today and is executed/);
});

test("a ChatGPT request is approved only by an owner, and never from ChatGPT", () => {
  assert.equal(mayApprove("owner", "chatgpt_tool", null), true);
  assert.equal(mayApprove("admin", "chatgpt_tool", null), false);
  assert.equal(mayApprove("technician", "chatgpt_tool", null), false);
  assert.equal(mayApproveFromChatGpt("chatgpt_tool", true), false);
  for (const message of ["send_text", "send_customer_message", "send_customer_email"]) {
    assert.equal(mayApproveFromChatGpt(message, true), false, message);
  }
  assert.equal(mayApproveFromChatGpt("send_contract", false), false);
  assert.equal(mayApproveFromChatGpt("add_job_note", false), true);
});

test("diagnostic payment tools that move money or reach a customer wait for the owner's approval", () => {
  for (const name of ["complete_diagnostic", "collect_diagnostic_payment", "send_payment_method_setup_link", "send_payment_recovery_link"]) {
    assert.equal(needsVolteiraApproval(name, { confirmed: true }), true, name);
    assert.equal(needsVolteiraApproval(name, { confirmed: false }), false, name);
  }
  for (const name of ["get_diagnostic_payment_status", "list_payment_exceptions"]) {
    assert.equal(needsVolteiraApproval(name, { confirmed: true }), false, name);
  }
});
