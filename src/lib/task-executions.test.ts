import assert from "node:assert/strict";
import { test } from "node:test";

import { approvalCheck, canDecide, needsApproval, readAssignInput } from "./task-execution-rules.ts";
import {
  approveProposal,
  assignToAssistant,
  cancelExecution,
  listAssistants,
  listChatgptWork,
  startChatgptWork,
  submitChatgptWork,
  reconcileStuckActions,
  rejectProposal,
  runExecution,
  type AssistantDecision,
  type AssistantDeps,
} from "./task-executions.ts";
import { createTask, completeTask, type Actor } from "./tasks-service.ts";

/*
 * Mocked checks only: an in-memory database with no row-level security (like
 * the server client these functions use), a stand-in model that returns a
 * chosen decision, and a stand-in SMS provider that counts sends. No real
 * model, text or database is touched; these are not live checks.
 */

type Row = Record<string, unknown>;
const ACTIVE = ["queued", "running", "waiting_input", "waiting_approval", "cancel_requested"];

function fakeDatabase(options: { chatgpt?: boolean } = {}) {
  const tables: Record<string, Row[]> = {
    tasks: [],
    task_activity: [],
    task_executions: [],
    task_proposals: [],
    task_work: [],
    task_notifications: [],
    user_profiles: [],
    conversations: [],
    messages: [],
    organization_members: [
      { organization_id: "org-a", user_id: "ann", role: "owner", impersonation_session_id: null },
      { organization_id: "org-a", user_id: "bob", role: "technician", impersonation_session_id: null },
      { organization_id: "org-b", user_id: "eve", role: "owner", impersonation_session_id: null },
    ],
    assistant_connections: [
      { id: "conn-a", organization_id: "org-a", display_name: "Volteira assistant (Claude)", provider: "anthropic", kind: "built_in", status: "active", capabilities: ["send_text", "add_job_note"], credential_ref: "env:TEST_KEY", created_at: "1" },
      ...(options.chatgpt
        ? [
            { id: "conn-g", organization_id: "org-a", display_name: "Your ChatGPT", provider: "chatgpt", kind: "external", status: "active", capabilities: ["send_text", "add_job_note"], credential_ref: null, created_at: "2" },
            { id: "conn-h", organization_id: "org-b", display_name: "Your ChatGPT", provider: "chatgpt", kind: "external", status: "active", capabilities: ["send_text", "add_job_note"], credential_ref: null, created_at: "2" },
          ]
        : []),
      { id: "conn-b", organization_id: "org-b", display_name: "Volteira assistant (Claude)", provider: "anthropic", kind: "built_in", status: "active", capabilities: ["send_text", "add_job_note"], credential_ref: "env:TEST_KEY", created_at: "1" },
    ],
    customers: [{ id: "cust-1", organization_id: "org-a", first_name: "Jo", last_name: "Smith", phone: "+15555550100" }],
    messaging_consent: [{ organization_id: "org-a", customer_id: "cust-1", channel: "sms", scope: "transactional", opted_in_at: "2026-11-01", opted_out_at: null, updated_at: "2026-11-01" }],
    messaging_settings: [{ organization_id: "org-a", messaging_service_sid: "MG-test" }],
    jobs: [
      { id: "11111111-1111-1111-1111-111111111111", organization_id: "org-a", job_number: 1042, customer_id: "cust-1", customer_description: "Panel replacement", status: "confirmed", technician_notes: null, archived_at: null, created_at: "2026-11-01" },
    ],
  };
  let counter = 0;

  function hydrate(table: string, row: Row): Row {
    if (table === "tasks") {
      const job = tables.jobs!.find((item) => item.id === row.job_id) ?? null;
      return { ...row, jobs: job ? hydrate("jobs", job) : null, task_series: null };
    }
    if (table === "jobs") return { ...row, customers: tables.customers!.find((item) => item.id === row.customer_id) ?? null };
    return row;
  }

  function violates(table: string, row: Row, list: Row[]): boolean {
    if (table === "task_executions") {
      if (ACTIVE.includes(String(row.status)) && list.some((other) => other !== row && other.task_id === row.task_id && ACTIVE.includes(String(other.status)))) return true;
      if (row.idempotency_key && list.some((other) => other !== row && other.organization_id === row.organization_id && other.idempotency_key === row.idempotency_key)) return true;
    }
    if (table === "task_work" && row.kind === "execution" && ["pending", "claimed"].includes(String(row.status))) {
      if (list.some((other) => other !== row && other.execution_id === row.execution_id && other.kind === "execution" && ["pending", "claimed"].includes(String(other.status)))) return true;
    }
    if (table === "task_notifications" && list.some((other) => other !== row && other.dedupe_key === row.dedupe_key)) return true;
    if (table === "tasks" && row.idempotency_key && list.some((other) => other !== row && other.organization_id === row.organization_id && other.idempotency_key === row.idempotency_key)) return true;
    return false;
  }

  const defaults: Record<string, Row> = {
    tasks: { version: 1, archived_at: null, completed_at: null, status: "todo" },
    task_executions: { status: "queued", attempt: 0, rounds: 0, usage: {}, started_at: null },
    task_proposals: { version: 1, status: "pending", pre_authorized: false, external_ref: null },
    task_work: { status: "pending", attempts: 0 },
  };

  function query(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row | Row[] = {};
    let limit = Infinity;
    let head = false;
    let ignoreDuplicates = false;
    let sort: { column: string; ascending: boolean } | null = null;
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: (_columns?: string, options?: { head?: boolean }) => ((head = options?.head === true), builder),
      order: (column: string, options?: { ascending?: boolean }) => ((sort = { column, ascending: options?.ascending !== false }), builder),
      eq: (column: string, value: unknown) => (filters.push((row) => row[column] === value), builder),
      is: (column: string) => (filters.push((row) => row[column] == null), builder),
      in: (column: string, values: unknown[]) => (filters.push((row) => values.includes(row[column])), builder),
      gte: (column: string, value: string) => (filters.push((row) => String(row[column] ?? "") >= value), builder),
      lte: (column: string, value: string) => (filters.push((row) => String(row[column] ?? "") <= value), builder),
      or: (expression: string) => {
        const parts = expression.split(",").map((part) => part.split(".eq."));
        filters.push((row) => parts.some(([column, value]) => String(row[column!]) === value));
        return builder;
      },
      limit: (count: number) => ((limit = count), builder),
      insert: (value: Row | Row[]) => ((mode = "insert"), (payload = value), builder),
      update: (value: Row) => ((mode = "update"), (payload = value), builder),
      upsert: (value: Row, options?: { ignoreDuplicates?: boolean }) => ((mode = "upsert"), (payload = value), (ignoreDuplicates = options?.ignoreDuplicates === true), builder),
      maybeSingle: () => run().then((result) => ({ ...result, data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data })),
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) => run().then(resolve, reject),
    });

    async function run(): Promise<{ data: unknown; error: unknown; count?: number }> {
      const list = tables[table] ?? (tables[table] = []);
      if (mode === "insert" || mode === "upsert") {
        const made: Row[] = [];
        for (const value of [payload].flat()) {
          const row = { id: `${String(++counter).padStart(8, "0")}-0000-4000-8000-000000000000`, created_at: new Date(Date.now() + counter).toISOString(), ...(defaults[table] ?? {}), ...value };
          if (violates(table, row, list)) {
            if (mode === "upsert" && ignoreDuplicates) continue;
            return { data: null, error: { code: "23505" } };
          }
          list.push(row);
          made.push(row);
        }
        return { data: made.map((row) => hydrate(table, row)), error: null };
      }
      const matched = list.filter((row) => filters.every((filter) => filter(row)));
      if (mode === "update") {
        const changed: Row[] = [];
        for (const row of matched) {
          const before = { ...row };
          Object.assign(row, payload);
          if (violates(table, row, list)) {
            Object.assign(row, before);
            return { data: null, error: { code: "23505" } };
          }
          changed.push(row);
        }
        return { data: changed.map((row) => hydrate(table, row)), error: null };
      }
      if (head) return { data: null, error: null, count: matched.length };
      const ordered = sort
        ? [...matched].sort((a, b) => {
            const left = String(a[sort!.column] ?? "");
            const right = String(b[sort!.column] ?? "");
            return (left < right ? -1 : left > right ? 1 : 0) * (sort!.ascending ? 1 : -1);
          })
        : matched;
      return { data: ordered.slice(0, limit).map((row) => hydrate(table, row)), error: null };
    }
    return builder;
  }

  return { database: { from: query } as never, tables };
}

const ann: Actor = { userId: "ann", organizationId: "org-a", role: "owner", timeZone: "America/Los_Angeles", via: "app" };
const bob: Actor = { ...ann, userId: "bob", role: "technician" };
const eve: Actor = { userId: "eve", organizationId: "org-b", role: "owner", timeZone: "America/Los_Angeles", via: "app" };

function stubs(decisions: AssistantDecision[], options: { keyed?: boolean; during?: () => Promise<void> } = {}) {
  const sent: { to: string; body: string }[] = [];
  const deps: AssistantDeps = {
    credentialAvailable: () => options.keyed !== false,
    decide: async () => {
      if (options.during) await options.during();
      const decision = decisions.shift();
      return decision ? { ok: true, decision } : { ok: false, error: "no decision", retry: false };
    },
    sendText: async (input) => {
      sent.push({ to: input.to, body: input.body });
      return { ok: true, providerMessageId: `SM${sent.length}`, status: "sent" };
    },
    takeAiUse: async () => ({ ok: true }),
  };
  return { deps, sent };
}

async function handOver(database: never, tables: Record<string, Row[]>, deps: AssistantDeps, mode: "prepare" | "execute_approved" = "prepare") {
  const made = await createTask(database, ann, { title: "Confirm Thursday", job: "1042" });
  assert.ok(made.ok, made.ok ? "" : JSON.stringify(made.error));
  const input = readAssignInput({ instructions: "Text the customer to confirm Thursday 9am.", permission_mode: mode });
  assert.ok(input.ok);
  const assigned = await assignToAssistant(database, ann, deps, made.value.task.id, input.value);
  assert.ok(assigned.ok, assigned.ok ? "" : assigned.error.message);
  const execution = assigned.value.execution!;
  const work = tables.task_work!.find((row) => row.execution_id === execution.id)!;
  return { taskId: made.value.task.id, executionId: execution.id, work: { ...work, attempts: 1 } };
}

const proposeText: AssistantDecision = { kind: "propose", action: "send_text", content: "Hi Jo, confirming Thursday 9am. - Pacific", reason: "Asked to confirm.", finish_after: true, summary: "Texted Jo to confirm Thursday." };

test("rules: a text always needs approval, and only the starter, the task's owner or an owner/admin may decide", () => {
  assert.equal(needsApproval("send_text", "prepare"), true);
  assert.equal(needsApproval("send_text", "execute_approved"), true, "pre-authorization never covers texting a customer");
  assert.equal(needsApproval("add_job_note", "execute_approved"), false);
  assert.equal(needsApproval("add_job_note", "prepare"), true);
  assert.equal(canDecide({ userId: "bob", role: "technician" }, { owner_id: "ann", created_by: "ann" }, { requested_by: "ann" }), false);
  assert.equal(canDecide({ userId: "bob", role: "technician" }, { owner_id: "ann" }, { requested_by: "bob" }), true);
  assert.equal(canDecide({ userId: "cy", role: "admin" }, {}, {}), true);
});

test("rules: an approval holds only for the pending version, the shown content, an unchanged task and before expiry", () => {
  const now = new Date("2026-11-07T12:00:00Z");
  const proposal = { status: "pending", version: 2, content_hash: "abc", task_version: 5, expires_at: "2026-11-08T12:00:00Z" };
  const task = { version: 5, status: "waiting_approval", archived_at: null };
  assert.ok(approvalCheck(proposal, task, { content_hash: "abc", version: 2 }, now).ok);
  assert.equal(approvalCheck(proposal, task, { content_hash: "xyz" }, now).ok, false, "different content");
  assert.equal(approvalCheck(proposal, task, {}, now).ok, false, "no hash given");
  assert.equal(approvalCheck(proposal, task, { content_hash: "abc", version: 1 }, now).ok, false, "older version");
  assert.equal(approvalCheck(proposal, { ...task, version: 6 }, { content_hash: "abc" }, now).ok, false, "task changed since");
  assert.equal(approvalCheck({ ...proposal, expires_at: "2026-11-07T11:00:00Z" }, task, { content_hash: "abc" }, now).ok, false, "expired");
  assert.equal(approvalCheck({ ...proposal, status: "approved" }, task, { content_hash: "abc" }, now).ok, false, "already decided");
  assert.equal(approvalCheck(proposal, { ...task, status: "complete" }, { content_hash: "abc" }, now).ok, false, "task closed");
});

test("an assistant without a key is shown as needing a connection and cannot take work", async () => {
  const { database } = fakeDatabase();
  const { deps } = stubs([], { keyed: false });
  const listed = await listAssistants(database, ann, deps);
  assert.equal(listed[0]!.state, "connection_required");
  assert.equal(listed.length, 1, "another business's assistant is not listed");
  assert.ok(!JSON.stringify(listed).includes("TEST_KEY"), "the credential reference is never returned");
  const made = await createTask(database, ann, { title: "x", job: "1042" });
  assert.ok(made.ok);
  const input = readAssignInput({ instructions: "do it" });
  assert.ok(input.ok);
  const refused = await assignToAssistant(database, ann, deps, made.value.task.id, input.value);
  assert.equal(!refused.ok && refused.error.code, "ASSISTANT_UNAVAILABLE");
});

test("a proposed text is not sent until approved with the shown content, and is sent once however often it is approved", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([proposeText]);
  const { taskId, executionId, work } = await handOver(database, tables, deps);

  assert.equal(await runExecution(database, deps, work), "ran");
  assert.equal(sent.length, 0, "nothing sent on proposal");
  const proposal = tables.task_proposals!.find((row) => row.execution_id === executionId)!;
  assert.equal(proposal.status, "pending");
  assert.equal((proposal.target as Row).customer_id, "cust-1", "the target comes from the job, not the assistant");
  assert.equal(tables.tasks!.find((row) => row.id === taskId)!.status, "waiting_approval");
  assert.ok(tables.task_notifications!.some((row) => row.kind === "approval" && row.user_id === "ann"));

  const wrong = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: "not-it" });
  assert.equal(!wrong.ok && wrong.error.code, "PROPOSAL_CHANGED");
  assert.equal(sent.length, 0);

  const otherBusiness = await approveProposal(database, eve, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.equal(!otherBusiness.ok && otherBusiness.error.code, "NOT_FOUND");
  const colleague = await approveProposal(database, bob, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.equal(!colleague.ok && colleague.error.code, "FORBIDDEN", "a technician who did not start the work cannot approve it");

  const approved = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: String(proposal.content_hash), version: 1 });
  assert.ok(approved.ok, approved.ok ? "" : approved.error.message);
  assert.equal(approved.value.proposal.status, "executed");
  assert.equal(sent.length, 1);
  assert.equal(sent[0]!.body, proposeText.content);
  assert.ok(approved.value.proposal.receipt?.message_id, "a receipt is kept");

  const again = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.equal(again.ok, false);
  assert.equal(sent.length, 1, "a second approval sends nothing");
  const task = tables.tasks!.find((row) => row.id === taskId)!;
  assert.equal(task.status, "complete", "finish_after completes the task");
  assert.equal(tables.task_executions!.find((row) => row.id === executionId)!.status, "succeeded");
});

test("consent withdrawn after the proposal: approval sends nothing", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([proposeText]);
  const { work } = await handOver(database, tables, deps);
  await runExecution(database, deps, work);
  const proposal = tables.task_proposals![0]!;
  tables.messaging_consent![0]!.opted_out_at = "2026-11-07T10:00:00Z";
  const approved = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.ok(approved.ok);
  assert.equal(approved.value.proposal.status, "failed");
  assert.equal(sent.length, 0);
});

test("a changed task invalidates the approval", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([proposeText]);
  const { taskId, work } = await handOver(database, tables, deps);
  await runExecution(database, deps, work);
  const proposal = tables.task_proposals![0]!;
  const task = tables.tasks!.find((row) => row.id === taskId)!;
  task.version = Number(task.version) + 1; // somebody edited the task
  const approved = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.equal(!approved.ok && approved.error.code, "PROPOSAL_CHANGED");
  assert.equal(sent.length, 0);
});

test("pre-authorization covers a job note but never a text", async () => {
  const { database, tables } = fakeDatabase();
  const note: AssistantDecision = { kind: "propose", action: "add_job_note", content: "Customer prefers mornings.", reason: "Useful.", finish_after: false, summary: "" };
  const { deps, sent } = stubs([note, proposeText]);
  const { executionId, work } = await handOver(database, tables, deps, "execute_approved");
  await runExecution(database, deps, work);
  const first = tables.task_proposals!.find((row) => row.action_type === "add_job_note")!;
  assert.equal(first.status, "executed");
  assert.equal(first.pre_authorized, true);
  assert.match(String(tables.jobs![0]!.technician_notes), /Customer prefers mornings/);

  const next = tables.task_work!.find((row) => row.execution_id === executionId && row.status === "pending")!;
  await runExecution(database, deps, { ...next, attempts: 1 });
  const text = tables.task_proposals!.find((row) => row.action_type === "send_text")!;
  assert.equal(text.status, "pending", "a text waits for a person even in execute_approved mode");
  assert.equal(sent.length, 0);
});

test("an action the rules don't allow is refused and nothing is done", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([{ kind: "propose", action: "refund_payment", content: "Refund $500", reason: "x", finish_after: true, summary: "" }]);
  const { executionId, work } = await handOver(database, tables, deps);
  assert.equal(await runExecution(database, deps, work), "failed");
  assert.equal(tables.task_proposals!.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(tables.task_executions!.find((row) => row.id === executionId)!.status, "failed");
});

test("work stopped while the assistant was deciding does nothing with the decision", async () => {
  const { database, tables } = fakeDatabase();
  let executionId = "";
  const { deps, sent } = stubs([proposeText], {
    during: async () => {
      const outcome = await cancelExecution(database, ann, deps, executionId);
      assert.ok(outcome.ok && outcome.value.execution?.status === "cancel_requested");
    },
  });
  const handed = await handOver(database, tables, deps);
  executionId = handed.executionId;
  assert.equal(await runExecution(database, deps, handed.work), "canceled");
  assert.equal(tables.task_proposals!.length, 0);
  assert.equal(sent.length, 0);
  assert.equal(tables.task_executions!.find((row) => row.id === executionId)!.status, "canceled");
});

test("completing the task by hand leaves a pending text unapprovable", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([proposeText]);
  const { taskId, work } = await handOver(database, tables, deps);
  await runExecution(database, deps, work);
  const proposal = tables.task_proposals![0]!;
  const done = await completeTask(database, ann, taskId);
  assert.ok(done.ok);
  // The database trigger supersedes the proposal; even without it, the approval check refuses a closed task.
  const approved = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.equal(approved.ok, false);
  assert.equal(sent.length, 0);
});

test("a text whose outcome was never written down is marked uncertain, not sent again", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([proposeText]);
  const { work } = await handOver(database, tables, deps);
  await runExecution(database, deps, work);
  const proposal = tables.task_proposals![0]!;
  // As if the process died after saving the message and before recording the result.
  tables.messages!.push({ id: "msg-stuck", organization_id: "org-a", status: "sending" });
  Object.assign(proposal, { status: "executing", executing_at: "2026-11-07T00:00:00Z", external_ref: "msg-stuck" });
  const tally = await reconcileStuckActions(database, deps);
  assert.deepEqual(tally, { executed: 0, failed: 0, uncertain: 1 });
  assert.equal(proposal.status, "uncertain");
  assert.equal(sent.length, 0);
  assert.ok(tables.task_notifications!.some((row) => row.kind === "failure"));
});

test("turning an action down stops the work; asking for changes makes a new version", async () => {
  const { database, tables } = fakeDatabase();
  const { deps, sent } = stubs([proposeText, { ...proposeText, content: "Hi Jo, see you Thursday at 9. - Pacific" }]);
  const { executionId, work } = await handOver(database, tables, deps);
  await runExecution(database, deps, work);
  const first = tables.task_proposals![0]!;
  const revised = await rejectProposal(database, ann, deps, String(first.id), { note: "Shorter please", revise: true });
  assert.ok(revised.ok);
  const next = tables.task_work!.find((row) => row.execution_id === executionId && row.status === "pending")!;
  await runExecution(database, deps, { ...next, attempts: 1 });
  const second = tables.task_proposals!.find((row) => row.version === 2)!;
  assert.equal(second.status, "pending");
  assert.notEqual(second.content_hash, first.content_hash);
  const rejected = await rejectProposal(database, ann, deps, String(second.id), { note: "No" });
  assert.ok(rejected.ok);
  assert.equal(tables.task_executions!.find((row) => row.id === executionId)!.status, "canceled");
  assert.equal(sent.length, 0);
});

/* The user's own ChatGPT does the work, through the connection. */

async function handToChatgpt(database: never, deps: AssistantDeps) {
  const made = await createTask(database, ann, { title: "Confirm Thursday", job: "1042" });
  assert.ok(made.ok);
  const input = readAssignInput({ instructions: "Text the customer to confirm Thursday 9am." });
  assert.ok(input.ok);
  const assigned = await assignToAssistant(database, ann, deps, made.value.task.id, input.value);
  assert.ok(assigned.ok, assigned.ok ? "" : assigned.error.message);
  return { taskId: made.value.task.id, executionId: assigned.value.execution!.id, execution: assigned.value.execution! };
}

test("ChatGPT is the default and its work never enters the background queue", async () => {
  const { database, tables } = fakeDatabase({ chatgpt: true });
  tables.assistant_connections!.find((row) => row.id === "conn-a")!.status = "disabled";
  const { deps } = stubs([]);
  const listed = await listAssistants(database, ann, deps);
  assert.equal(listed[0]!.kind, "external");
  assert.equal(listed[0]!.state, "ready");
  const { execution } = await handToChatgpt(database, deps);
  assert.equal(execution.runs_in, "chatgpt");
  assert.equal(execution.status, "queued");
  assert.equal(tables.task_work!.length, 0, "nothing for the server to run");
});

test("only people who may decide, in the same business, can pick ChatGPT work up", async () => {
  const { database } = fakeDatabase({ chatgpt: true });
  const { deps } = stubs([]);
  const { executionId } = await handToChatgpt(database, deps);
  assert.equal((await listChatgptWork(database, ann)).length, 1);
  assert.equal((await listChatgptWork(database, eve)).length, 0, "another business sees nothing");
  assert.equal((await listChatgptWork(database, bob)).length, 0, "a technician who did not start it is not offered it");
  const theirs = await startChatgptWork(database, eve, deps, executionId);
  assert.equal(!theirs.ok && theirs.error.code, "NOT_FOUND");
  const colleague = await startChatgptWork(database, bob, deps, executionId);
  assert.equal(!colleague.ok && colleague.error.code, "FORBIDDEN");
});

test("a text ChatGPT proposes waits for approval and is sent once", async () => {
  const { database, tables } = fakeDatabase({ chatgpt: true });
  const { deps, sent } = stubs([]);
  const { taskId, executionId } = await handToChatgpt(database, deps);
  const started = await startChatgptWork(database, ann, deps, executionId);
  assert.ok(started.ok, started.ok ? "" : started.error.message);
  assert.deepEqual(started.value.context.allowed_actions, ["send_text", "add_job_note"]);
  assert.equal(started.value.context.job?.customer_name, "Jo Smith");

  const submitted = await submitChatgptWork(database, ann, deps, executionId, proposeText);
  assert.ok(submitted.ok, submitted.ok ? "" : submitted.error.message);
  assert.equal(submitted.value.execution?.status, "waiting_approval");
  assert.equal(sent.length, 0, "proposing sends nothing");
  const again = await submitChatgptWork(database, ann, deps, executionId, proposeText);
  assert.equal(again.ok, false, "one report per pick-up");

  const proposal = tables.task_proposals![0]!;
  const approved = await approveProposal(database, ann, deps, String(proposal.id), { content_hash: String(proposal.content_hash) });
  assert.ok(approved.ok && approved.value.proposal.status === "executed");
  assert.equal(sent.length, 1);
  assert.equal(tables.tasks!.find((row) => row.id === taskId)!.status, "complete");
});

test("ChatGPT cannot propose something the rules don't allow", async () => {
  const { database, tables } = fakeDatabase({ chatgpt: true });
  const { deps, sent } = stubs([]);
  const { executionId } = await handToChatgpt(database, deps);
  await startChatgptWork(database, ann, deps, executionId);
  const refused = await submitChatgptWork(database, ann, deps, executionId, { kind: "propose", action: "charge_card", content: "Charge $900", reason: "x", finish_after: true, summary: "" });
  assert.equal(!refused.ok && refused.error.code, "ACTION_REFUSED");
  assert.equal(tables.task_proposals!.length, 0);
  assert.equal(sent.length, 0);
});

test("stopping ChatGPT work takes effect at once, and a late report is refused", async () => {
  const { database, tables } = fakeDatabase({ chatgpt: true });
  const { deps, sent } = stubs([]);
  const { executionId } = await handToChatgpt(database, deps);
  await startChatgptWork(database, ann, deps, executionId);
  const stopped = await cancelExecution(database, ann, deps, executionId);
  assert.ok(stopped.ok && stopped.value.execution?.status === "canceled");
  const late = await submitChatgptWork(database, ann, deps, executionId, proposeText);
  assert.equal(late.ok, false);
  assert.equal(tables.task_proposals!.length, 0);
  assert.equal(sent.length, 0);
});
