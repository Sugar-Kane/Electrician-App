import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

import * as phone from "./phone-format.ts";
import * as policy from "./supervised-actions.ts";

/*
 * ChatGPT's supervised-action tools, with the database functions replaced by
 * recorders. What matters: the model can't name who approves, can't pick the
 * recipient, can't approve binding or financial actions from ChatGPT, and
 * can't approve without the owner's confirmation and the fingerprint.
 */

const source = ts.transpileModule(readFileSync(new URL("./mcp-supervised-tools.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

const UUID_A = "11111111-1111-4111-8111-111111111111";
const HASH = `sha256:${"a".repeat(64)}`;

function harness(env: Record<string, string>, proposal: Record<string, unknown> = { actionType: "send_customer_message" }) {
  const created: Record<string, unknown>[] = [];
  const decided: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      const data = table === "jobs" ? { id: "job-1", customer_id: "cust-1" } : table === "customers" ? { phone: "805-555-0100", email: "Pat@Example.com" } : null;
      const q = { select: () => q, eq: () => q, maybeSingle: async () => ({ data, error: null }) };
      return q;
    },
  };
  const exports: { runSupervisedTool?: (input: unknown) => Promise<{ text: string; isError?: boolean }> } = {};
  runInNewContext(source, {
    exports,
    process: { env },
    require(name: string) {
      if (name === "server-only") return {};
      if (name.endsWith("/phone-format")) return phone;
      if (name.endsWith("/supervised-actions")) return policy;
      if (name.endsWith("/supervised-actions-server"))
        return {
          UUID: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
          createSupervisedProposal: async (input: Record<string, unknown>) => {
            created.push(input);
            return { ok: true, id: UUID_A, contentHash: HASH, status: "pending", created: true };
          },
          decideForVerifiedActor: async (input: Record<string, unknown>) => {
            decided.push(input);
            return { ok: true, code: "ok", status: "approved" };
          },
          getSupervisedProposal: async () => ({ proposal: proposal, audit: [] }),
          listSupervisedProposals: async () => ({ ok: true, proposals: [], counts: {} }),
        };
      throw new Error(`unexpected import ${name}`);
    },
  });
  const run = (name: string, args: Record<string, unknown>, actorUserId: string | null = "owner-1") =>
    exports.runSupervisedTool!({ database: db, organizationId: "org-1", actorUserId, credentialId: "cred-1", name, args });
  return { run, created, decided };
}

const ON = { VOLTEIRA_PHASE2_MCP_ENABLED: "true", VOLTEIRA_PHASE2_APPROVALS_ENABLED: "true" };

test("the tools do nothing unless turned on", async () => {
  const h = harness({});
  const result = await h.run("propose_action", { action_type: "send_customer_message", job_number: "19", message: "Hi", reason: "r" });
  assert.equal(result.isError, true);
  assert.equal(h.created.length, 0);
});

test("a proposal is the AI's, for the connection's business, to the number on file", async () => {
  const h = harness(ON);
  await h.run("propose_action", {
    action_type: "send_customer_message",
    job_number: "19",
    message: "Hi Pat",
    reason: "Follow up",
    // A model trying to choose the business or recipient is ignored.
    organization_id: "another-business",
    recipient: "+19995550000",
  });
  assert.equal(h.created[0]?.organizationId, "org-1");
  assert.equal(h.created[0]?.recipient, "+18055550100");
  assert.equal(h.created[0]?.proposedByKind, "ai");
  assert.equal(h.created[0]?.templateKey, null);
});

test("approval needs the owner's confirmation and the fingerprint", async () => {
  const h = harness(ON);
  assert.match((await h.run("approve_proposal", { proposal_id: UUID_A, fingerprint: HASH, confirmed: false })).text, /CONFIRMATION REQUIRED/);
  assert.equal((await h.run("approve_proposal", { proposal_id: UUID_A, fingerprint: "sha256:short", confirmed: true })).isError, true);
  assert.equal(h.decided.length, 0);
  await h.run("approve_proposal", { proposal_id: UUID_A, fingerprint: HASH, confirmed: true, actor: "someone-else" });
  assert.equal(h.decided[0]?.actorUserId, "owner-1");
  assert.equal(h.decided[0]?.via, "chatgpt");
});

test("no verified owner, no decision", async () => {
  const h = harness(ON);
  const result = await h.run("approve_proposal", { proposal_id: UUID_A, fingerprint: HASH, confirmed: true }, null);
  assert.equal(result.isError, true);
  assert.equal(h.decided.length, 0);
});

test("binding and financial actions are approved in Volteira, not from ChatGPT", async () => {
  for (const actionType of ["issue_refund", "send_contract", "purchase_materials"]) {
    const h = harness(ON, { actionType });
    const result = await h.run("approve_proposal", { proposal_id: UUID_A, fingerprint: HASH, confirmed: true });
    assert.equal(result.isError, true, actionType);
    assert.equal(h.decided.length, 0, actionType);
    // Rejecting is always allowed.
    await h.run("reject_proposal", { proposal_id: UUID_A, fingerprint: HASH });
    assert.equal(h.decided.length, 1, actionType);
  }
});

test("approvals stay off until the approvals flag is on", async () => {
  const h = harness({ VOLTEIRA_PHASE2_MCP_ENABLED: "true" });
  assert.equal((await h.run("approve_proposal", { proposal_id: UUID_A, fingerprint: HASH, confirmed: true })).isError, true);
  assert.equal(h.decided.length, 0);
});
