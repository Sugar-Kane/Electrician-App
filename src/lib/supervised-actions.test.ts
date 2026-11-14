import assert from "node:assert/strict";
import { test } from "node:test";
import { mayApprove, mayBeginExecution, mayDecide, transitionProposal, requiresHumanApproval, type ActionProposal } from "./supervised-actions.ts";

const proposal: ActionProposal = {
  id: "proposal-1", organizationId: "business-1", createdBy: "assistant-1",
  action: "send_contract", payloadDigest: "sha256:approved-contents",
  state: "proposed", expiresAt: "2027-01-01T00:00:00.000Z",
};

test("financial and binding actions require owner approval", () => {
  for (const action of ["send_contract", "send_estimate", "purchase_materials", "issue_refund", "change_price", "cancel_job"] as const) {
    assert.equal(requiresHumanApproval(action), true);
    assert.equal(mayApprove("owner", action), true);
    assert.equal(mayApprove("admin", action), false);
  }
  assert.equal(mayApprove("admin", "send_customer_message"), true);
  assert.equal(mayApprove("technician", "send_customer_message"), false);
  assert.equal(requiresHumanApproval("create_internal_task"), false);
});

test("decision rejects cross-tenant, self approval, wrong digest, and expiry", () => {
  const decision = { actorId: "nick", role: "owner", at: "2026-11-14T00:00:00.000Z", actionDigest: proposal.payloadDigest };
  const now = new Date("2026-11-14T00:00:00.000Z");
  assert.equal(mayDecide(proposal, decision, "business-1", now), true);
  assert.equal(mayDecide(proposal, decision, "business-2", now), false);
  assert.equal(mayDecide(proposal, { ...decision, actorId: proposal.createdBy }, "business-1", now), false);
  assert.equal(mayDecide(proposal, { ...decision, actionDigest: "different" }, "business-1", now), false);
  assert.equal(mayDecide(proposal, decision, "business-1", new Date("2027-01-01T00:00:00.000Z")), false);
  assert.equal(mayDecide({ ...proposal, state: "rejected" }, decision, "business-1", now), false);
});

test("execution requires current approved record, matching payload and no prior execution", () => {
  const approved: ActionProposal = { ...proposal, state: "approved", approvedBy: "nick", approvedAt: "2026-11-14T00:00:00.000Z" };
  const now = new Date("2026-11-14T00:00:00.000Z");
  assert.equal(mayBeginExecution(approved, "business-1", proposal.payloadDigest, now), true);
  assert.equal(mayBeginExecution(approved, "business-2", proposal.payloadDigest, now), false);
  assert.equal(mayBeginExecution(approved, "business-1", "changed-payload", now), false);
  assert.equal(mayBeginExecution({ ...approved, executionId: "already-executed" }, "business-1", proposal.payloadDigest, now), false);
  assert.equal(mayBeginExecution({ ...approved, approvedBy: null }, "business-1", proposal.payloadDigest, now), false);
  assert.equal(mayBeginExecution({ ...approved, state: "rejected" }, "business-1", proposal.payloadDigest, now), false);
});

test("approval -> claim -> completion is one-way and scoped to a business", () => {
  const now = new Date("2026-11-14T00:00:00.000Z");
  const decision = { actorId: "nick", role: "owner", at: now.toISOString(), actionDigest: proposal.payloadDigest };
  const approved = transitionProposal(proposal, { type: "approve", decision }, "business-1", now);
  assert.equal(approved.ok, true);
  if (!approved.ok) return;
  const claimed = transitionProposal(approved.proposal, {
    type: "claim_execution", organizationId: "business-1", actionDigest: proposal.payloadDigest, executionId: "execution-1",
  }, "business-1", now);
  assert.equal(claimed.ok, true);
  if (!claimed.ok) return;
  assert.equal(claimed.proposal.state, "executing");
  assert.equal(transitionProposal(claimed.proposal, {
    type: "claim_execution", organizationId: "business-1", actionDigest: proposal.payloadDigest, executionId: "execution-2",
  }, "business-1", now).ok, false);
  assert.equal(transitionProposal(claimed.proposal, { type: "execution_succeeded", executionId: "wrong" }, "business-1", now).ok, false);
  const finished = transitionProposal(claimed.proposal, { type: "execution_succeeded", executionId: "execution-1" }, "business-1", now);
  assert.equal(finished.ok, true);
  if (finished.ok) assert.equal(finished.proposal.state, "completed");
  assert.equal(transitionProposal(claimed.proposal, { type: "execution_failed", executionId: "execution-1" }, "business-2", now).ok, false);
});

test("reject and expiry cannot be executed", () => {
  const now = new Date("2026-11-14T00:00:00.000Z");
  const decision = { actorId: "nick", role: "owner", at: now.toISOString(), actionDigest: proposal.payloadDigest };
  const rejected = transitionProposal(proposal, { type: "reject", decision }, "business-1", now);
  assert.equal(rejected.ok, true);
  if (rejected.ok) assert.equal(mayBeginExecution(rejected.proposal, "business-1", proposal.payloadDigest, now), false);
  const expired = transitionProposal(proposal, { type: "expire" }, "business-1", new Date("2027-01-01T00:00:00.000Z"));
  assert.equal(expired.ok, true);
  if (expired.ok) assert.equal(expired.proposal.state, "expired");
});
