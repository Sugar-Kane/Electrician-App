import { createHash } from "node:crypto";

import { sendCustomerText, textingAllowed, type SmsSender } from "./customer-text.ts";
import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";
import {
  ACTION_LABELS,
  APPROVAL_WINDOW_HOURS,
  EXECUTION_LABELS,
  MAX_ATTEMPTS,
  MAX_ROUNDS,
  approvalCheck,
  canDecide,
  cancelOutcome,
  isActionType,
  isActiveExecution,
  needsApproval,
  type ActionType,
  type AssignInput,
  type ExecutionStatus,
  type PermissionMode,
} from "./task-execution-rules.ts";
import { fail, isClosed, type Result } from "./task-rules.ts";
import { getTask, jobLabel, taskUrl, type Actor, type TaskSummary } from "./tasks-service.ts";

/**
 * Assistant work on tasks: handing a task to an assistant, running it in the
 * background worker, the actions it proposes, and a person's approval.
 *
 * - Who may act is checked the way the rest of tasks checks it (getTask with
 *   the visibility rule), and again for deciding (canDecide).
 * - Writes go through the server client; people read the rows under
 *   row-level security.
 * - Nothing leaves Volteira without a person's approval of that exact
 *   content, except a job note the person who started the work pre-authorized.
 *   Approval re-checks consent, the target and the task right before acting.
 * - An action whose outcome was never written down is reconciled from the
 *   record it left (the message row), never sent again.
 *
 * The model, the SMS provider and the AI allowance are passed in (`deps`), so
 * the rules here can be tested with stand-ins.
 */

type Database = FlexibleSupabaseClient;
type Row = Record<string, unknown>;

export type AssistantContext = {
  task: { title: string; notes: string | null; due: string | null };
  instructions: string;
  completion_criteria: string | null;
  permission_mode: PermissionMode;
  job: { label: string; status: string; customer_name: string | null; can_text_customer: boolean; technician_notes: string | null } | null;
  recent_texts: { direction: "inbound" | "outbound"; body: string; at: string }[];
  history: string[];
  allowed_actions: ActionType[];
};

export type AssistantDecision =
  | { kind: "finish"; summary: string }
  | { kind: "ask"; question: string }
  | { kind: "propose"; action: string; content: string; reason: string; finish_after: boolean; summary: string };

export type DecisionOutcome = { ok: true; decision: AssistantDecision; usage?: Row } | { ok: false; error: string; retry: boolean };

export type AssistantDeps = {
  /** Whether the deployment holds the key this connection names. Never returns the key. */
  credentialAvailable: (credentialRef: string) => boolean;
  decide: (context: AssistantContext) => Promise<DecisionOutcome>;
  sendText: SmsSender;
  takeAiUse: (organizationId: string, feature: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  now?: () => Date;
};

export type AssistantConnection = {
  id: string;
  name: string;
  provider: string;
  state: "ready" | "connection_required" | "disabled";
  usable: boolean;
  note: string;
  capabilities: string[];
};

export type ProposalView = {
  id: string;
  version: number;
  action: string;
  action_label: string;
  target_label: string;
  content: string;
  reason: string | null;
  content_hash: string;
  status: string;
  pre_authorized: boolean;
  expires_at: string;
  decided_at: string | null;
  decision_note: string | null;
  receipt: Row | null;
  error: string | null;
  created_at: string;
};

export type ExecutionView = {
  id: string;
  task_id: string;
  status: ExecutionStatus;
  status_label: string;
  stage: string | null;
  permission_mode: PermissionMode;
  instructions: string | null;
  completion_criteria: string | null;
  question: string | null;
  answer: string | null;
  result_summary: string | null;
  error: string | null;
  attempt: number;
  rounds: number;
  scheduled_for: string;
  started_at: string | null;
  finished_at: string | null;
  connection: string | null;
  requested_by_you: boolean;
  can_decide: boolean;
  proposals: ProposalView[];
  created_at: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function one(value: unknown): Row {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Row) : {};
}

function rows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

function clock(deps: Pick<AssistantDeps, "now">): Date {
  return deps.now ? deps.now() : new Date();
}

const ID = /^[0-9a-f-]{36}$/i;
const EXECUTION_COLUMNS =
  "id, organization_id, task_id, connection_id, requested_by, requested_via, task_version, instructions, completion_criteria, permission_mode, status, stage, attempt, rounds, scheduled_for, started_at, finished_at, cancel_requested_at, question, answer, feedback, result_summary, error, usage, idempotency_key, created_at";
const PROPOSAL_COLUMNS =
  "id, organization_id, task_id, execution_id, version, task_version, action_type, target, content, reason, content_hash, limits, status, pre_authorized, decided_by, decided_via, decided_at, decision_note, expires_at, executing_at, executed_at, external_ref, receipt, error, created_at";

/* ------------------------------------------------------------------ */
/* Connections                                                         */
/* ------------------------------------------------------------------ */

function connectionView(row: Row, deps: Pick<AssistantDeps, "credentialAvailable">): AssistantConnection {
  const disabled = text(row.status) !== "active";
  const keyed = deps.credentialAvailable(text(row.credential_ref));
  const state = disabled ? "disabled" : keyed ? "ready" : "connection_required";
  return {
    id: text(row.id),
    name: text(row.display_name),
    provider: text(row.provider),
    state,
    usable: state === "ready",
    note:
      state === "ready"
        ? "Ready. It prepares work and asks before texting anyone."
        : state === "disabled"
          ? "Turned off for this business."
          : "Connection required: this Volteira deployment has no key for this assistant yet, so it cannot take work.",
    capabilities: Array.isArray(row.capabilities) ? (row.capabilities as unknown[]).map(text).filter(Boolean) : [],
  };
}

/** Every assistant connection of the business, with an honest state. No credential is ever returned. */
export async function listAssistants(db: Database, actor: Actor, deps: Pick<AssistantDeps, "credentialAvailable">): Promise<AssistantConnection[]> {
  const { data } = await db
    .from("assistant_connections")
    .select("id, display_name, provider, status, capabilities, credential_ref")
    .eq("organization_id", actor.organizationId)
    .order("created_at", { ascending: true });
  return rows(data).map((row) => connectionView(row, deps));
}

async function usableConnection(db: Database, organizationId: string, deps: Pick<AssistantDeps, "credentialAvailable">, id?: string | null): Promise<Result<Row>> {
  let query = db
    .from("assistant_connections")
    .select("id, display_name, provider, status, capabilities, credential_ref")
    .eq("organization_id", organizationId);
  query = id ? query.eq("id", id) : query.eq("kind", "built_in");
  const { data } = await query.limit(1).maybeSingle();
  const row = data as Row | null;
  if (!row) return fail("ASSISTANT_UNAVAILABLE", "That assistant is not connected to this business.");
  const view = connectionView(row, deps);
  if (!view.usable) return fail("ASSISTANT_UNAVAILABLE", `${view.name}: ${view.note}`);
  return { ok: true, value: row };
}

/* ------------------------------------------------------------------ */
/* Small writes shared by the people and worker paths                  */
/* ------------------------------------------------------------------ */

async function activity(db: Database, organizationId: string, taskId: string, event: string, detail: Row, who: Actor | "assistant" | "system") {
  const { error } = await db.from("task_activity").insert({
    organization_id: organizationId,
    task_id: taskId,
    actor_type: who === "assistant" ? "assistant" : who === "system" ? "system" : "user",
    actor_user_id: typeof who === "object" ? who.userId : null,
    via: typeof who === "object" ? who.via : "system",
    event,
    detail,
  });
  if (error) console.error("task activity could not be recorded", { taskId, event, code: error.code });
}

async function notify(db: Database, input: { organizationId: string; userId: string | null; taskId: string; kind: "approval" | "input" | "result" | "failure"; title: string; body?: string; key: string }) {
  if (!input.userId) return;
  const { error } = await db.from("task_notifications").upsert(
    {
      organization_id: input.organizationId,
      user_id: input.userId,
      task_id: input.taskId,
      kind: input.kind,
      title: input.title.slice(0, 300),
      body: input.body ? input.body.slice(0, 1000) : null,
      dedupe_key: input.key,
    },
    { onConflict: "dedupe_key", ignoreDuplicates: true },
  );
  if (error) console.error("task notification could not be saved", { taskId: input.taskId, code: error.code });
}

/**
 * A change to the task made by the system (status, assistant summary). It
 * moves the version on like any change, so an approval given against the old
 * version no longer fits. Retries briefly if somebody saves at the same moment.
 */
async function systemTaskUpdate(db: Database, organizationId: string, taskId: string, patch: Row): Promise<number | null> {
  for (let tries = 0; tries < 3; tries += 1) {
    const { data } = await db.from("tasks").select("version").eq("organization_id", organizationId).eq("id", taskId).maybeSingle();
    if (!data) return null;
    const read = Number((data as Row).version ?? 1);
    const { data: saved } = await db
      .from("tasks")
      .update({ ...patch, version: read + 1, updated_at: new Date().toISOString() })
      .eq("organization_id", organizationId)
      .eq("id", taskId)
      .eq("version", read)
      .select("id")
      .maybeSingle();
    if (saved) return read + 1;
  }
  return null;
}

async function enqueue(db: Database, execution: Row, runAt: string): Promise<void> {
  const { error } = await db.from("task_work").insert({
    organization_id: execution.organization_id,
    task_id: execution.task_id,
    execution_id: execution.id,
    kind: "execution",
    run_at: runAt,
    task_version: execution.task_version,
    max_attempts: MAX_ATTEMPTS,
  });
  // 23505: a live queue row for this execution already exists, which is what we want.
  if (error && error.code !== "23505") throw new Error(`work not queued (${error.code ?? "unknown"})`);
}

async function updateExecution(db: Database, id: string, patch: Row, fromStatuses?: string[]): Promise<Row | null> {
  let query = db.from("task_executions").update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
  if (fromStatuses) query = query.in("status", fromStatuses);
  const { data } = await query.select(EXECUTION_COLUMNS).maybeSingle();
  return (data as Row | null) ?? null;
}

/* ------------------------------------------------------------------ */
/* Reading                                                             */
/* ------------------------------------------------------------------ */

function targetLabel(action: string, target: Row): string {
  if (action === "send_text") return `${text(target.customer_name) || "The customer"}${text(target.phone_last4) ? ` (phone ending ${text(target.phone_last4)})` : ""}`;
  if (action === "add_job_note") return text(target.job_label) || "The job";
  return "";
}

function proposalView(row: Row): ProposalView {
  const action = text(row.action_type);
  const target = one(row.target);
  return {
    id: text(row.id),
    version: Number(row.version ?? 1),
    action,
    action_label: isActionType(action) ? ACTION_LABELS[action] : action,
    target_label: targetLabel(action, target),
    content: text(row.content),
    reason: text(row.reason) || null,
    content_hash: text(row.content_hash),
    status: text(row.status),
    pre_authorized: row.pre_authorized === true,
    expires_at: text(row.expires_at),
    decided_at: text(row.decided_at) || null,
    decision_note: text(row.decision_note) || null,
    receipt: row.receipt && typeof row.receipt === "object" ? (row.receipt as Row) : null,
    error: text(row.error) || null,
    created_at: text(row.created_at),
  };
}

function executionView(row: Row, proposals: Row[], actor: Actor, task: Row, connections: Map<string, string>): ExecutionView {
  const status = text(row.status) as ExecutionStatus;
  return {
    id: text(row.id),
    task_id: text(row.task_id),
    status,
    status_label: EXECUTION_LABELS[status] ?? status,
    stage: text(row.stage) || null,
    permission_mode: (text(row.permission_mode) || "prepare") as PermissionMode,
    instructions: text(row.instructions) || null,
    completion_criteria: text(row.completion_criteria) || null,
    question: text(row.question) || null,
    answer: text(row.answer) || null,
    result_summary: text(row.result_summary) || null,
    error: text(row.error) || null,
    attempt: Number(row.attempt ?? 0),
    rounds: Number(row.rounds ?? 0),
    scheduled_for: text(row.scheduled_for),
    started_at: text(row.started_at) || null,
    finished_at: text(row.finished_at) || null,
    connection: connections.get(text(row.connection_id)) ?? null,
    requested_by_you: text(row.requested_by) === actor.userId,
    can_decide: canDecide(actor, task, row),
    proposals: proposals.filter((proposal) => proposal.execution_id === row.id).map(proposalView),
    created_at: text(row.created_at),
  };
}

/** A task's assistant work, newest first, with the actions each proposed. */
export async function listExecutions(db: Database, actor: Actor, taskId: string, limit = 10): Promise<Result<{ task: TaskSummary; executions: ExecutionView[] }>> {
  const found = await getTask(db, actor, taskId);
  if (!found.ok) return found;
  const { data } = await db
    .from("task_executions")
    .select(EXECUTION_COLUMNS)
    .eq("organization_id", actor.organizationId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(limit);
  const executions = rows(data);
  const ids = executions.map((row) => text(row.id));
  const [{ data: proposals }, { data: connections }] = await Promise.all([
    ids.length
      ? db.from("task_proposals").select(PROPOSAL_COLUMNS).eq("organization_id", actor.organizationId).in("execution_id", ids).order("created_at", { ascending: false })
      : Promise.resolve({ data: [] as Row[] }),
    db.from("assistant_connections").select("id, display_name").eq("organization_id", actor.organizationId),
  ]);
  const names = new Map(rows(connections).map((row) => [text(row.id), text(row.display_name)]));
  return {
    ok: true,
    value: { task: found.value.task, executions: executions.map((row) => executionView(row, rows(proposals), actor, found.value.raw, names)) },
  };
}

/** One execution (or the task's latest), checked against the task's visibility. */
export async function getExecution(db: Database, actor: Actor, ref: { task_id?: string; execution_id?: string }): Promise<Result<{ task: TaskSummary; execution: ExecutionView | null }>> {
  let taskId = ref.task_id ?? "";
  if (ref.execution_id) {
    if (!ID.test(ref.execution_id)) return fail("NOT_FOUND", "That assistant work was not found.");
    const { data } = await db.from("task_executions").select("task_id").eq("organization_id", actor.organizationId).eq("id", ref.execution_id).maybeSingle();
    if (!data) return fail("NOT_FOUND", "That assistant work was not found.");
    taskId = text((data as Row).task_id);
  }
  if (!taskId) return fail("INVALID_INPUT", "Say which task.", "task_id");
  const listed = await listExecutions(db, actor, taskId, 20);
  if (!listed.ok) return listed;
  const execution = ref.execution_id ? (listed.value.executions.find((item) => item.id === ref.execution_id) ?? null) : (listed.value.executions[0] ?? null);
  return { ok: true, value: { task: listed.value.task, execution } };
}

/* ------------------------------------------------------------------ */
/* Assigning and starting                                              */
/* ------------------------------------------------------------------ */

/** Hand a task to an assistant, with what to do, what done looks like, and what it may do without asking. */
export async function assignToAssistant(
  db: Database,
  actor: Actor,
  deps: AssistantDeps,
  taskId: string,
  input: AssignInput,
  options: { version?: number; request_id?: string } = {},
): Promise<Result<{ task: TaskSummary; execution: ExecutionView | null }>> {
  const found = await getTask(db, actor, taskId);
  if (!found.ok) return found;
  const raw = found.value.raw;
  if (raw.archived_at) return fail("ARCHIVED", "That task is archived.");
  if (isClosed(text(raw.status))) return fail("INVALID_INPUT", "That task is closed. Reopen it first.");
  const connection = await usableConnection(db, actor.organizationId, deps, input.connection_id);
  if (!connection.ok) return connection;
  const { data: active } = await db
    .from("task_executions")
    .select("id")
    .eq("organization_id", actor.organizationId)
    .eq("task_id", taskId)
    .in("status", ["queued", "running", "waiting_input", "waiting_approval", "cancel_requested"])
    .limit(1)
    .maybeSingle();
  if (active) return fail("EXECUTION_ACTIVE", "An assistant is already working on this task. Stop that work first.");

  const read = Number(raw.version ?? 1);
  if (options.version !== undefined && options.version !== read) {
    return fail("VERSION_CONFLICT", "Someone changed this task at the same moment. Look at it again, then make your change.");
  }
  const { data: saved } = await db
    .from("tasks")
    .update({
      assignee_type: "assistant",
      assignee_user_id: null,
      assistant_connection_id: text(connection.value.id),
      ai_instructions: input.instructions,
      completion_criteria: input.completion_criteria,
      ai_permission_mode: input.permission_mode,
      execution_mode: input.start === "later" ? "none" : input.start,
      scheduled_execution_at: input.scheduled_at,
      version: read + 1,
      updated_at: new Date().toISOString(),
    })
    .eq("organization_id", actor.organizationId)
    .eq("id", taskId)
    .eq("version", read)
    .select("id")
    .maybeSingle();
  if (!saved) return fail("VERSION_CONFLICT", "Someone changed this task at the same moment. Look at it again, then make your change.");
  await activity(db, actor.organizationId, taskId, "assigned_to_assistant", { assistant: text(connection.value.display_name), permission_mode: input.permission_mode, start: input.start }, actor);

  if (input.start === "later") {
    const after = await getTask(db, actor, taskId);
    return after.ok ? { ok: true, value: { task: after.value.task, execution: null } } : after;
  }
  return startExecution(db, actor, deps, taskId, { request_id: options.request_id, scheduled_at: input.scheduled_at });
}

/** Queue a run of the assistant on a task already handed to it. One active run per task. */
export async function startExecution(
  db: Database,
  actor: Actor,
  deps: AssistantDeps,
  taskId: string,
  options: { request_id?: string; scheduled_at?: string | null } = {},
): Promise<Result<{ task: TaskSummary; execution: ExecutionView | null }>> {
  const now = clock(deps);
  const key = options.request_id?.trim().slice(0, 200) || null;
  if (key) {
    const { data: earlier } = await db.from("task_executions").select("id, task_id").eq("organization_id", actor.organizationId).eq("idempotency_key", key).maybeSingle();
    if (earlier) return getExecution(db, actor, { execution_id: text((earlier as Row).id) });
  }
  const found = await getTask(db, actor, taskId);
  if (!found.ok) return found;
  const raw = found.value.raw;
  if (raw.archived_at) return fail("ARCHIVED", "That task is archived.");
  if (isClosed(text(raw.status))) return fail("INVALID_INPUT", "That task is closed. Reopen it first.");
  if (text(raw.assignee_type) !== "assistant" || !text(raw.ai_instructions)) {
    return fail("INVALID_INPUT", "Assign the task to an assistant first, with instructions.");
  }
  const connection = await usableConnection(db, actor.organizationId, deps, text(raw.assistant_connection_id) || null);
  if (!connection.ok) return connection;

  const runAt = options.scheduled_at && Date.parse(options.scheduled_at) > now.getTime() ? options.scheduled_at : now.toISOString();
  const { data: created, error } = await db
    .from("task_executions")
    .insert({
      organization_id: actor.organizationId,
      task_id: taskId,
      connection_id: text(connection.value.id),
      requested_by: actor.userId,
      requested_via: actor.via,
      task_version: Number(raw.version ?? 1),
      instructions: text(raw.ai_instructions),
      completion_criteria: text(raw.completion_criteria) || null,
      permission_mode: text(raw.ai_permission_mode) === "execute_approved" ? "execute_approved" : "prepare",
      status: "queued",
      stage: runAt === now.toISOString() ? "Starting within a minute" : "Scheduled",
      scheduled_for: runAt,
      idempotency_key: key,
    })
    .select(EXECUTION_COLUMNS)
    .maybeSingle();
  if (error?.code === "23505") return fail("EXECUTION_ACTIVE", "An assistant is already working on this task. Stop that work first.");
  if (error || !created) return fail("SAVE_FAILED", "The work could not be queued. Try again.");
  const execution = created as Row;
  try {
    await enqueue(db, execution, runAt);
  } catch {
    await updateExecution(db, text(execution.id), { status: "failed", error: "The work could not be queued.", finished_at: now.toISOString() });
    return fail("SAVE_FAILED", "The work could not be queued. Try again.");
  }
  await activity(db, actor.organizationId, taskId, "execution_queued", { execution_id: execution.id, scheduled_for: runAt }, actor);
  return getExecution(db, actor, { execution_id: text(execution.id) });
}

/* ------------------------------------------------------------------ */
/* People deciding                                                     */
/* ------------------------------------------------------------------ */

async function loadForDecision(db: Database, actor: Actor, proposalId: string): Promise<Result<{ proposal: Row; execution: Row; task: Row }>> {
  if (!ID.test(proposalId)) return fail("NOT_FOUND", "That proposed action was not found.");
  const { data } = await db.from("task_proposals").select(PROPOSAL_COLUMNS).eq("organization_id", actor.organizationId).eq("id", proposalId).maybeSingle();
  const proposal = data as Row | null;
  if (!proposal) return fail("NOT_FOUND", "That proposed action was not found.");
  const found = await getTask(db, actor, text(proposal.task_id));
  if (!found.ok) return fail("NOT_FOUND", "That proposed action was not found.");
  const { data: execution } = await db.from("task_executions").select(EXECUTION_COLUMNS).eq("organization_id", actor.organizationId).eq("id", text(proposal.execution_id)).maybeSingle();
  if (!execution) return fail("NOT_FOUND", "That proposed action was not found.");
  if (!canDecide(actor, found.value.raw, execution as Row)) {
    return fail("FORBIDDEN", "Only the person who started this work, the task's owner, or an owner or admin of the business can decide this.");
  }
  return { ok: true, value: { proposal, execution: execution as Row, task: found.value.raw } };
}

/**
 * Approve one proposed action, for the version and content the person saw,
 * and carry it out now. Consent, the target and the task are checked again
 * right before anything is done.
 */
export async function approveProposal(
  db: Database,
  actor: Actor,
  deps: AssistantDeps,
  proposalId: string,
  given: { content_hash?: string; version?: number },
): Promise<Result<{ proposal: ProposalView; execution: ExecutionView | null; message: string }>> {
  const now = clock(deps);
  const loaded = await loadForDecision(db, actor, proposalId);
  if (!loaded.ok) return loaded;
  const { proposal, task } = loaded.value;
  const check = approvalCheck(
    {
      status: text(proposal.status),
      version: Number(proposal.version ?? 1),
      content_hash: text(proposal.content_hash),
      task_version: Number(proposal.task_version ?? 0),
      expires_at: text(proposal.expires_at),
    },
    { version: Number(task.version ?? 1), status: text(task.status), archived_at: text(task.archived_at) || null },
    given,
    now,
  );
  if (!check.ok) {
    if (check.error.code === "PROPOSAL_EXPIRED") await db.from("task_proposals").update({ status: "expired" }).eq("id", proposalId).eq("status", "pending");
    return check;
  }
  // Only one approval wins, however many arrive at once.
  const { data: claimed } = await db
    .from("task_proposals")
    .update({ status: "approved", decided_by: actor.userId, decided_via: actor.via, decided_at: now.toISOString() })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select(PROPOSAL_COLUMNS)
    .maybeSingle();
  if (!claimed) return fail("INVALID_INPUT", "That action was already decided.");
  await activity(
    db,
    actor.organizationId,
    text(proposal.task_id),
    "action_approved",
    { proposal_id: proposalId, action: proposal.action_type, target: targetLabel(text(proposal.action_type), one(proposal.target)), content: proposal.content, content_hash: proposal.content_hash, expires_at: proposal.expires_at },
    actor,
  );
  const outcome = await executeProposal(db, deps, claimed as Row);
  const after = await getExecution(db, actor, { execution_id: text(proposal.execution_id) });
  const { data: final } = await db.from("task_proposals").select(PROPOSAL_COLUMNS).eq("id", proposalId).maybeSingle();
  return {
    ok: true,
    value: { proposal: proposalView((final as Row) ?? (claimed as Row)), execution: after.ok ? after.value.execution : null, message: outcome.message },
  };
}

/** Turn an action down, or send it back with what to change. A revision is a new proposal version. */
export async function rejectProposal(
  db: Database,
  actor: Actor,
  deps: AssistantDeps,
  proposalId: string,
  input: { note?: string; revise?: boolean },
): Promise<Result<{ execution: ExecutionView | null; message: string }>> {
  const now = clock(deps);
  const loaded = await loadForDecision(db, actor, proposalId);
  if (!loaded.ok) return loaded;
  const { proposal, execution } = loaded.value;
  const note = (input.note ?? "").trim().slice(0, 2000);
  if (input.revise && !note) return fail("INVALID_INPUT", "Say what to change.", "note");
  const { data: decided } = await db
    .from("task_proposals")
    .update({ status: input.revise ? "revision_requested" : "rejected", decided_by: actor.userId, decided_via: actor.via, decided_at: now.toISOString(), decision_note: note || null })
    .eq("id", proposalId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (!decided) return fail("INVALID_INPUT", "That action is no longer waiting for a decision.");
  const taskId = text(proposal.task_id);
  await activity(db, actor.organizationId, taskId, input.revise ? "action_revision_requested" : "action_rejected", { proposal_id: proposalId, note: note || null }, actor);

  if (input.revise && Number(execution.rounds ?? 0) < MAX_ROUNDS) {
    const requeued = await updateExecution(
      db,
      text(execution.id),
      { status: "queued", stage: "Revising with your note", feedback: note, question: null },
      ["waiting_approval"],
    );
    if (requeued) {
      await enqueue(db, requeued, now.toISOString());
      await systemTaskUpdate(db, actor.organizationId, taskId, { status: "in_progress" });
    }
    const after = await getExecution(db, actor, { execution_id: text(execution.id) });
    return { ok: true, value: { execution: after.ok ? after.value.execution : null, message: "Sent back to the assistant with your note. It will propose a new version." } };
  }

  await updateExecution(
    db,
    text(execution.id),
    { status: "canceled", stage: input.revise ? "Stopped: too many rounds" : "Stopped: the action was turned down", finished_at: now.toISOString(), canceled_by: actor.userId },
    ["waiting_approval"],
  );
  await systemTaskUpdate(db, actor.organizationId, taskId, { status: "todo" });
  const after = await getExecution(db, actor, { execution_id: text(execution.id) });
  return { ok: true, value: { execution: after.ok ? after.value.execution : null, message: "Turned down. Nothing was done, and the assistant has stopped." } };
}

/** Answer the assistant's question; the work picks up again. */
export async function answerExecution(db: Database, actor: Actor, deps: AssistantDeps, executionId: string, answer: string): Promise<Result<{ execution: ExecutionView | null }>> {
  const now = clock(deps);
  const reply = answer.trim().slice(0, 4000);
  if (!reply) return fail("INVALID_INPUT", "Write an answer.", "answer");
  const current = await getExecution(db, actor, { execution_id: executionId });
  if (!current.ok) return current;
  if (!current.value.execution || current.value.execution.status !== "waiting_input") return fail("INVALID_INPUT", "That work is not waiting for an answer.");
  if (!current.value.execution.can_decide) return fail("FORBIDDEN", "Only the person who started this work, the task's owner, or an owner or admin can answer for it.");
  const requeued = await updateExecution(db, executionId, { status: "queued", stage: "Continuing with your answer", answer: reply }, ["waiting_input"]);
  if (!requeued) return fail("VERSION_CONFLICT", "That work changed at the same moment. Look at it again.");
  await enqueue(db, requeued, now.toISOString());
  await systemTaskUpdate(db, actor.organizationId, current.value.task.id, { status: "in_progress" });
  await activity(db, actor.organizationId, current.value.task.id, "assistant_answered", { execution_id: executionId }, actor);
  const after = await getExecution(db, actor, { execution_id: executionId });
  return after.ok ? { ok: true, value: { execution: after.value.execution } } : after;
}

/** Stop assistant work: at once if it is not running, or at its next check if it is. */
export async function cancelExecution(db: Database, actor: Actor, deps: AssistantDeps, executionId: string): Promise<Result<{ execution: ExecutionView | null; message: string }>> {
  const now = clock(deps);
  const current = await getExecution(db, actor, { execution_id: executionId });
  if (!current.ok) return current;
  const execution = current.value.execution;
  if (!execution) return fail("NOT_FOUND", "That assistant work was not found.");
  if (!execution.can_decide) return fail("FORBIDDEN", "Only the person who started this work, the task's owner, or an owner or admin can stop it.");
  const outcome = cancelOutcome(execution.status);
  if (!outcome.ok) return outcome;
  const saved = await updateExecution(
    db,
    executionId,
    outcome.value === "canceled"
      ? { status: "canceled", stage: "Stopped", finished_at: now.toISOString(), cancel_requested_at: now.toISOString(), canceled_by: actor.userId }
      : { status: "cancel_requested", stage: "Stopping", cancel_requested_at: now.toISOString(), canceled_by: actor.userId },
    [execution.status],
  );
  if (!saved) return fail("VERSION_CONFLICT", "That work changed at the same moment. Look at it again.");
  if (outcome.value === "canceled") {
    await db.from("task_work").update({ status: "canceled", finished_at: now.toISOString(), last_error: "Stopped by a person." }).eq("execution_id", executionId).eq("status", "pending");
    await db.from("task_proposals").update({ status: "superseded", decision_note: "The work was stopped." }).eq("execution_id", executionId).eq("status", "pending");
    await systemTaskUpdate(db, actor.organizationId, current.value.task.id, { status: "todo" });
  }
  await activity(db, actor.organizationId, current.value.task.id, "execution_canceled", { execution_id: executionId, immediate: outcome.value === "canceled" }, actor);
  const after = await getExecution(db, actor, { execution_id: executionId });
  return {
    ok: true,
    value: {
      execution: after.ok ? after.value.execution : null,
      message: outcome.value === "canceled" ? "Stopped. Nothing more will be done." : "Stopping. The assistant will stop before doing anything else.",
    },
  };
}

/* ------------------------------------------------------------------ */
/* Carrying out an approved action                                     */
/* ------------------------------------------------------------------ */

/** A fingerprint of exactly what would be done, so an approval covers that and nothing else. */
export function contentHash(action: string, target: Record<string, unknown>, content: string): string {
  const stable = JSON.stringify({ action, target: Object.keys(target).sort().map((key) => [key, target[key]]), content });
  return createHash("sha256").update(stable).digest("hex").slice(0, 32);
}

function digest(value: string): string {
  return createHash("sha256").update(value.replace(/\D/g, "")).digest("hex").slice(0, 16);
}

function noteLine(proposal: Row, now: Date): string {
  const day = now.toISOString().slice(0, 10);
  return `[${day} · assistant · ref ${text(proposal.id).slice(0, 8)}] ${text(proposal.content)}`;
}

async function finishProposal(db: Database, id: string, patch: Row) {
  await db.from("task_proposals").update(patch).eq("id", id).eq("status", "executing");
}

/**
 * Carry out an approved (or pre-authorized) action once. The row is moved to
 * "executing" first, so a second caller finds nothing to do; the outcome and
 * its receipt are written afterwards. If the process dies in between, the
 * reconciler reads what happened instead of trying again.
 */
export async function executeProposal(db: Database, deps: AssistantDeps, approved: Row): Promise<{ ok: boolean; message: string }> {
  const now = clock(deps);
  const id = text(approved.id);
  const organizationId = text(approved.organization_id);
  const { data: started } = await db
    .from("task_proposals")
    .update({ status: "executing", executing_at: now.toISOString() })
    .eq("id", id)
    .eq("status", "approved")
    .select(PROPOSAL_COLUMNS)
    .maybeSingle();
  if (!started) return { ok: false, message: "That action is already being carried out, or was." };
  const proposal = started as Row;
  const target = one(proposal.target);
  const action = text(proposal.action_type);

  // The task must still be open and the work not stopped.
  const [{ data: task }, { data: execution }] = await Promise.all([
    db.from("tasks").select("id, status, archived_at, job_id").eq("organization_id", organizationId).eq("id", text(proposal.task_id)).maybeSingle(),
    db.from("task_executions").select(EXECUTION_COLUMNS).eq("id", text(proposal.execution_id)).maybeSingle(),
  ]);
  const taskRow = task as Row | null;
  const executionRow = execution as Row | null;
  const refusal = (message: string) => finishProposal(db, id, { status: "failed", error: message, executed_at: now.toISOString() }).then(() => ({ ok: false, message }));
  if (!taskRow || taskRow.archived_at || isClosed(text(taskRow.status))) return afterAction(db, deps, proposal, await refusal("The task was closed, so nothing was done."), false);
  if (!executionRow || ["cancel_requested", "canceled"].includes(text(executionRow.status))) {
    return afterAction(db, deps, proposal, await refusal("The work was stopped, so nothing was done."), false);
  }

  if (action === "send_text") {
    const customerId = text(target.customer_id);
    const allowed = customerId ? await textingAllowed(db, organizationId, customerId) : null;
    if (!allowed || !allowed.ok) return afterAction(db, deps, proposal, await refusal(allowed ? `${allowed.message} Nothing was sent.` : "No customer to text."), false);
    if (digest(allowed.phone) !== text(target.phone_digest)) {
      return afterAction(db, deps, proposal, await refusal("The customer's phone number changed after this was proposed. Nothing was sent."), false);
    }
    const sent = await sendCustomerText(db, {
      organizationId,
      customerId,
      body: text(proposal.content),
      send: deps.sendText,
      onSaved: async (messageId) => {
        await db.from("task_proposals").update({ external_ref: messageId }).eq("id", id);
      },
    });
    if (sent.ok) {
      await finishProposal(db, id, {
        status: "executed",
        executed_at: clock(deps).toISOString(),
        receipt: { message_id: sent.messageId, conversation_id: sent.conversationId, provider_message_id: sent.providerMessageId },
      });
      return afterAction(db, deps, proposal, { ok: true, message: `Texted ${text(target.customer_name) || "the customer"}. It is in their conversation in Volteira.` }, true);
    }
    await finishProposal(db, id, { status: "failed", executed_at: clock(deps).toISOString(), error: sent.message.slice(0, 1000) });
    return afterAction(db, deps, proposal, { ok: false, message: sent.message }, false);
  }

  if (action === "add_job_note") {
    const jobId = text(target.job_id);
    if (!jobId || jobId !== text(taskRow.job_id)) return afterAction(db, deps, proposal, await refusal("The task is no longer on that job. Nothing was added."), false);
    const { data: job } = await db.from("jobs").select("id, technician_notes").eq("organization_id", organizationId).eq("id", jobId).maybeSingle();
    if (!job) return afterAction(db, deps, proposal, await refusal("The job was not found. Nothing was added."), false);
    const existing = text((job as Row).technician_notes);
    const line = noteLine(proposal, now);
    const { error } = await db
      .from("jobs")
      .update({ technician_notes: existing ? `${existing}\n${line}` : line })
      .eq("organization_id", organizationId)
      .eq("id", jobId);
    if (error) {
      await finishProposal(db, id, { status: "failed", executed_at: clock(deps).toISOString(), error: "The note could not be saved." });
      return afterAction(db, deps, proposal, { ok: false, message: "The note could not be saved." }, false);
    }
    await finishProposal(db, id, { status: "executed", executed_at: clock(deps).toISOString(), external_ref: `note:${id.slice(0, 8)}`, receipt: { job_id: jobId, appended: line.slice(0, 200) } });
    return afterAction(db, deps, proposal, { ok: true, message: "Added the note to the job." }, true);
  }

  return afterAction(db, deps, proposal, await refusal("The assistant cannot do that."), false);
}

/** After an action: finish the work, or let the assistant carry on, or record why it stopped. */
async function afterAction(db: Database, deps: AssistantDeps, proposal: Row, outcome: { ok: boolean; message: string }, done: boolean): Promise<{ ok: boolean; message: string }> {
  const now = clock(deps);
  const organizationId = text(proposal.organization_id);
  const taskId = text(proposal.task_id);
  const executionId = text(proposal.execution_id);
  await activity(db, organizationId, taskId, done ? "action_done" : "action_failed", { proposal_id: proposal.id, action: proposal.action_type, message: outcome.message }, "system");
  const { data } = await db.from("task_executions").select(EXECUTION_COLUMNS).eq("id", executionId).maybeSingle();
  const execution = data as Row | null;
  if (!execution) return outcome;
  const limits = one(proposal.limits);
  const recipient = text(execution.requested_by) || null;

  if (!done) {
    if (isActiveExecution(text(execution.status))) {
      await updateExecution(db, executionId, { status: "failed", stage: "Stopped: an action did not go through", error: outcome.message.slice(0, 1000), finished_at: now.toISOString() });
      await systemTaskUpdate(db, organizationId, taskId, { status: "todo" });
      await notify(db, { organizationId, userId: recipient, taskId, kind: "failure", title: "Assistant work stopped", body: outcome.message, key: `failure:${text(proposal.id)}` });
    }
    return outcome;
  }

  if (limits.finish_after === true || Number(execution.rounds ?? 0) >= MAX_ROUNDS) {
    const summary = text(limits.summary) || outcome.message;
    const finished = await updateExecution(
      db,
      executionId,
      { status: "succeeded", stage: "Done", result_summary: summary.slice(0, 10000), finished_at: now.toISOString() },
      ["running", "waiting_approval"],
    );
    if (finished) {
      await systemTaskUpdate(db, organizationId, taskId, { status: "complete", completed_at: now.toISOString(), completion_summary: summary.slice(0, 10000) });
      await activity(db, organizationId, taskId, "completed", { by_assistant: true, execution_id: executionId }, "assistant");
      await notify(db, { organizationId, userId: recipient, taskId, kind: "result", title: "Assistant finished a task", body: summary, key: `result:${executionId}` });
    }
    return outcome;
  }

  const requeued = await updateExecution(
    db,
    executionId,
    { status: "queued", stage: "Continuing after the approved action", feedback: null },
    ["running", "waiting_approval"],
  );
  if (requeued) {
    await enqueue(db, requeued, now.toISOString());
    await systemTaskUpdate(db, organizationId, taskId, { status: "in_progress" });
  }
  return outcome;
}

/* ------------------------------------------------------------------ */
/* The worker's part                                                   */
/* ------------------------------------------------------------------ */

async function buildContext(db: Database, task: Row, execution: Row): Promise<AssistantContext> {
  const organizationId = text(task.organization_id);
  const jobId = text(task.job_id);
  let job: AssistantContext["job"] = null;
  let recent: AssistantContext["recent_texts"] = [];
  if (jobId) {
    const { data } = await db
      .from("jobs")
      .select("id, job_number, customer_description, status, technician_notes, customer_id, customers(id, first_name, last_name, company_name)")
      .eq("organization_id", organizationId)
      .eq("id", jobId)
      .maybeSingle();
    const row = data as Row | null;
    if (row) {
      const customer = one(row.customers);
      const customerId = text(row.customer_id);
      const allowed = customerId ? await textingAllowed(db, organizationId, customerId) : null;
      job = {
        label: jobLabel(row),
        status: text(row.status),
        customer_name: text(customer.company_name) || [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ") || null,
        can_text_customer: Boolean(allowed?.ok),
        technician_notes: text(row.technician_notes).slice(-3000) || null,
      };
      if (customerId) {
        const { data: conversation } = await db
          .from("conversations")
          .select("id")
          .eq("organization_id", organizationId)
          .eq("customer_id", customerId)
          .eq("channel", "sms")
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        const conversationId = text((conversation as Row | null)?.id);
        if (conversationId) {
          const { data: messages } = await db
            .from("messages")
            .select("direction, body, created_at")
            .eq("organization_id", organizationId)
            .eq("conversation_id", conversationId)
            .order("created_at", { ascending: false })
            .limit(12);
          recent = rows(messages)
            .reverse()
            .map((message) => ({ direction: text(message.direction) === "inbound" ? "inbound" : "outbound", body: text(message.body).slice(0, 600), at: text(message.created_at) }));
        }
      }
    }
  }

  const { data: earlier } = await db
    .from("task_proposals")
    .select("version, action_type, content, status, decision_note, error")
    .eq("execution_id", text(execution.id))
    .order("created_at", { ascending: true });
  const history: string[] = [];
  for (const proposal of rows(earlier)) {
    history.push(`Proposed ${text(proposal.action_type)} v${text(proposal.version)}: "${text(proposal.content).slice(0, 300)}" -> ${text(proposal.status)}${text(proposal.decision_note) ? ` (note: ${text(proposal.decision_note)})` : ""}${text(proposal.error) ? ` (error: ${text(proposal.error)})` : ""}`);
  }
  if (text(execution.question)) history.push(`You asked: ${text(execution.question)}`);
  if (text(execution.answer)) history.push(`The person answered: ${text(execution.answer)}`);
  if (text(execution.feedback)) history.push(`The person asked you to revise: ${text(execution.feedback)}`);

  const mode = (text(execution.permission_mode) || "prepare") as PermissionMode;
  const allowed: ActionType[] = [];
  if (job?.can_text_customer) allowed.push("send_text");
  if (jobId) allowed.push("add_job_note");
  return {
    task: { title: text(task.title), notes: text(task.notes) || null, due: text(task.due_date) ? `${text(task.due_date)}${text(task.due_time) ? ` ${text(task.due_time).slice(0, 5)}` : ""}` : null },
    instructions: text(execution.instructions),
    completion_criteria: text(execution.completion_criteria) || null,
    permission_mode: mode,
    job,
    recent_texts: recent,
    history,
    allowed_actions: allowed,
  };
}

async function resolveTarget(db: Database, task: Row, action: ActionType): Promise<Result<Row>> {
  const organizationId = text(task.organization_id);
  const jobId = text(task.job_id);
  if (!jobId) return fail("ACTION_REFUSED", "The task is not on a job, so there is nobody to act for.");
  const { data } = await db
    .from("jobs")
    .select("id, job_number, customer_description, customer_id, customers(id, first_name, last_name, company_name)")
    .eq("organization_id", organizationId)
    .eq("id", jobId)
    .maybeSingle();
  const job = data as Row | null;
  if (!job) return fail("ACTION_REFUSED", "The task's job was not found.");
  if (action === "add_job_note") return { ok: true, value: { job_id: jobId, job_label: jobLabel(job) } };
  const customerId = text(job.customer_id);
  if (!customerId) return fail("ACTION_REFUSED", "The job has no customer.");
  const allowed = await textingAllowed(db, organizationId, customerId);
  if (!allowed.ok) return fail("ACTION_REFUSED", allowed.message);
  const customer = one(job.customers);
  return {
    ok: true,
    value: {
      customer_id: customerId,
      customer_name: text(customer.company_name) || [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ") || "The customer",
      phone_last4: allowed.phone.replace(/\D/g, "").slice(-4),
      phone_digest: digest(allowed.phone),
      job_id: jobId,
    },
  };
}

export type ExecutionStep = "ran" | "skipped" | "canceled" | "failed" | "retry";

/**
 * One claimed queue row for an execution: run the assistant once and act on
 * what it decided. Never throws for a model problem; a model that fails is
 * tried again a few times, then the work is marked failed.
 */
export async function runExecution(db: Database, deps: AssistantDeps, work: Row): Promise<ExecutionStep> {
  const now = clock(deps);
  const executionId = text(work.execution_id);
  const { data } = await db.from("task_executions").select(EXECUTION_COLUMNS).eq("id", executionId).maybeSingle();
  let execution = data as Row | null;
  // Claimed again after a run died part-way (its lease ran out): the model
  // call has no effect outside Volteira, so the work starts that step again.
  if (execution && text(execution.status) === "running" && Number(work.attempts ?? 1) > 1) {
    execution = await updateExecution(db, executionId, { status: "queued", stage: "Picking up again after an interruption" }, ["running"]);
  }
  if (!execution || text(execution.status) !== "queued") return text(execution?.status) === "canceled" ? "canceled" : "skipped";
  const organizationId = text(execution.organization_id);
  const taskId = text(execution.task_id);
  const recipient = text(execution.requested_by) || null;

  const { data: taskData } = await db.from("tasks").select("*").eq("organization_id", organizationId).eq("id", taskId).maybeSingle();
  const task = taskData as Row | null;
  if (!task || task.archived_at || isClosed(text(task.status))) {
    await updateExecution(db, executionId, { status: "canceled", stage: "Stopped because the task was closed", finished_at: now.toISOString() }, ["queued"]);
    return "canceled";
  }

  const failWith = async (message: string) => {
    await updateExecution(db, executionId, { status: "failed", stage: "Failed", error: message.slice(0, 1000), finished_at: now.toISOString() }, ["queued", "running"]);
    await systemTaskUpdate(db, organizationId, taskId, { status: "todo" });
    await activity(db, organizationId, taskId, "execution_failed", { execution_id: executionId, error: message.slice(0, 300) }, "system");
    await notify(db, { organizationId, userId: recipient, taskId, kind: "failure", title: `Assistant could not finish: ${text(task.title)}`, body: message, key: `failure:${executionId}:${text(execution.rounds)}` });
    return "failed" as const;
  };

  const connection = await usableConnection(db, organizationId, deps, text(execution.connection_id) || null);
  if (!connection.ok) return failWith(connection.error.message);
  if (Number(execution.rounds ?? 0) >= MAX_ROUNDS) return failWith("The assistant went back and forth too many times without finishing.");

  const claimed = await updateExecution(
    db,
    executionId,
    { status: "running", stage: "Reading the task and the job", started_at: text(execution.started_at) || now.toISOString(), attempt: Number(execution.attempt ?? 0) + 1, rounds: Number(execution.rounds ?? 0) + 1 },
    ["queued"],
  );
  if (!claimed) return "skipped";
  await systemTaskUpdate(db, organizationId, taskId, { status: "in_progress" });

  const allowance = await deps.takeAiUse(organizationId, "task_assistant");
  if (!allowance.ok) return failWith(allowance.message);

  const context = await buildContext(db, task, claimed);
  const decided = await deps.decide(context);
  if (!decided.ok) {
    if (decided.retry && Number(claimed.attempt ?? 1) < MAX_ATTEMPTS) {
      await updateExecution(db, executionId, { status: "queued", stage: "Trying again shortly", error: decided.error.slice(0, 1000), rounds: Number(claimed.rounds ?? 1) - 1 }, ["running"]);
      return "retry";
    }
    return failWith(decided.error);
  }
  if (decided.usage) await updateExecution(db, executionId, { usage: { ...one(claimed.usage), ...decided.usage } });

  // Stopped while the assistant was thinking? Then nothing it decided is acted on.
  const { data: latest } = await db.from("task_executions").select("status").eq("id", executionId).maybeSingle();
  const { data: latestTask } = await db.from("tasks").select("status, archived_at").eq("id", taskId).maybeSingle();
  if (text((latest as Row | null)?.status) !== "running" || !latestTask || (latestTask as Row).archived_at || isClosed(text((latestTask as Row).status))) {
    await updateExecution(db, executionId, { status: "canceled", stage: "Stopped", finished_at: now.toISOString() });
    if (latestTask && !(latestTask as Row).archived_at && !isClosed(text((latestTask as Row).status))) {
      await systemTaskUpdate(db, organizationId, taskId, { status: "todo" });
    }
    await activity(db, organizationId, taskId, "execution_canceled", { execution_id: executionId, before_acting: true }, "system");
    return "canceled";
  }

  const decision = decided.decision;
  if (decision.kind === "finish") {
    const summary = decision.summary.trim().slice(0, 10000) || "Done.";
    await updateExecution(db, executionId, { status: "succeeded", stage: "Done", result_summary: summary, finished_at: now.toISOString() }, ["running"]);
    await systemTaskUpdate(db, organizationId, taskId, { status: "complete", completed_at: now.toISOString(), completion_summary: summary });
    await activity(db, organizationId, taskId, "completed", { by_assistant: true, execution_id: executionId }, "assistant");
    await notify(db, { organizationId, userId: recipient, taskId, kind: "result", title: `Assistant finished: ${text(task.title)}`, body: summary, key: `result:${executionId}` });
    return "ran";
  }

  if (decision.kind === "ask") {
    const question = decision.question.trim().slice(0, 2000) || "What should I do next?";
    await updateExecution(db, executionId, { status: "waiting_input", stage: "Waiting for your answer", question, answer: null }, ["running"]);
    await systemTaskUpdate(db, organizationId, taskId, { status: "waiting_input" });
    await activity(db, organizationId, taskId, "assistant_asked", { execution_id: executionId, question: question.slice(0, 300) }, "assistant");
    await notify(db, { organizationId, userId: recipient, taskId, kind: "input", title: `Assistant needs an answer: ${text(task.title)}`, body: question, key: `input:${executionId}:${text(claimed.rounds)}` });
    return "ran";
  }

  // A proposed action. Only the types the rules know, only what this
  // connection may do, and the target always comes from the task's job.
  const action = decision.action;
  const capabilities = Array.isArray(connection.value.capabilities) ? (connection.value.capabilities as unknown[]).map(text) : [];
  if (!isActionType(action) || !capabilities.includes(action)) return failWith(`The assistant asked to do something it is not allowed to do (${action.slice(0, 40)}). Nothing was done.`);
  const content = decision.content.trim().slice(0, action === "send_text" ? 500 : 2000);
  if (!content) return failWith("The assistant proposed an empty action. Nothing was done.");
  const target = await resolveTarget(db, task, action);
  if (!target.ok) {
    await updateExecution(db, executionId, { status: "waiting_input", stage: "Waiting for your answer", question: `I wanted to ${ACTION_LABELS[action].toLowerCase()}, but: ${target.error.message} How should I go on?` }, ["running"]);
    await systemTaskUpdate(db, organizationId, taskId, { status: "waiting_input" });
    await notify(db, { organizationId, userId: recipient, taskId, kind: "input", title: `Assistant needs an answer: ${text(task.title)}`, body: target.error.message, key: `input:${executionId}:${text(claimed.rounds)}` });
    return "ran";
  }

  const mode = (text(claimed.permission_mode) || "prepare") as PermissionMode;
  const approval = needsApproval(action, mode);
  await db.from("task_proposals").update({ status: "superseded" }).eq("execution_id", executionId).in("status", ["pending", "approved"]);
  const { count } = await db.from("task_proposals").select("id", { count: "exact", head: true }).eq("execution_id", executionId);
  const taskVersion = approval ? await systemTaskUpdate(db, organizationId, taskId, { status: "waiting_approval" }) : Number(task.version ?? 1);
  const { data: inserted, error } = await db
    .from("task_proposals")
    .insert({
      organization_id: organizationId,
      task_id: taskId,
      execution_id: executionId,
      version: Number(count ?? 0) + 1,
      task_version: taskVersion ?? Number(task.version ?? 1),
      action_type: action,
      target: target.value,
      content,
      reason: decision.reason.trim().slice(0, 1000) || null,
      content_hash: contentHash(action, target.value, content),
      limits: { once: true, finish_after: decision.finish_after, summary: decision.summary.trim().slice(0, 2000) || null },
      status: approval ? "pending" : "approved",
      pre_authorized: !approval,
      decided_via: approval ? null : "system",
      decided_at: approval ? null : now.toISOString(),
      expires_at: new Date(now.getTime() + APPROVAL_WINDOW_HOURS * 3_600_000).toISOString(),
    })
    .select(PROPOSAL_COLUMNS)
    .maybeSingle();
  if (error || !inserted) return failWith("The proposed action could not be saved.");

  if (!approval) {
    await activity(db, organizationId, taskId, "action_pre_authorized", { proposal_id: (inserted as Row).id, action, permission_mode: mode }, "system");
    await executeProposal(db, deps, inserted as Row);
    return "ran";
  }
  await updateExecution(db, executionId, { status: "waiting_approval", stage: "Waiting for your approval" }, ["running"]);
  await activity(db, organizationId, taskId, "action_proposed", { execution_id: executionId, proposal_id: (inserted as Row).id, action }, "assistant");
  await notify(db, {
    organizationId,
    userId: recipient,
    taskId,
    kind: "approval",
    title: `Approve: ${ACTION_LABELS[action]} · ${text(task.title)}`,
    body: content.slice(0, 300),
    key: `approval:${text((inserted as Row).id)}`,
  });
  return "ran";
}

/**
 * Actions left "executing" for more than five minutes: the process carrying
 * them out died before writing down what happened. Read the record they left
 * and settle them; a text whose fate cannot be told is marked uncertain and a
 * person is told to look, never sent again.
 */
export async function reconcileStuckActions(db: Database, deps: AssistantDeps): Promise<{ executed: number; failed: number; uncertain: number }> {
  const now = clock(deps);
  const cutoff = new Date(now.getTime() - 5 * 60_000).toISOString();
  const { data } = await db.from("task_proposals").select(PROPOSAL_COLUMNS).eq("status", "executing").lte("executing_at", cutoff).limit(50);
  const tally = { executed: 0, failed: 0, uncertain: 0 };
  for (const proposal of rows(data)) {
    const id = text(proposal.id);
    const action = text(proposal.action_type);
    let status: "executed" | "failed" | "uncertain" = "uncertain";
    let receipt: Row | null = null;
    let error: string | null = null;
    if (action === "send_text") {
      const messageId = text(proposal.external_ref);
      if (!messageId) {
        status = "failed";
        error = "Stopped before the text was saved; it was never sent.";
      } else {
        const { data: message } = await db.from("messages").select("id, status, provider_message_id").eq("id", messageId).maybeSingle();
        const state = text((message as Row | null)?.status);
        if (state === "sent" || state === "delivered") {
          status = "executed";
          receipt = { message_id: messageId, provider_message_id: text((message as Row).provider_message_id) || null, reconciled: true };
        } else if (state === "failed" || state === "undelivered") {
          status = "failed";
          error = "The text did not go through.";
        } else {
          error = "It is not known whether this text was sent. Check the customer's conversation before sending anything again.";
        }
      }
    } else if (action === "add_job_note") {
      const target = one(proposal.target);
      const { data: job } = await db.from("jobs").select("technician_notes").eq("id", text(target.job_id)).maybeSingle();
      const added = text((job as Row | null)?.technician_notes).includes(`ref ${id.slice(0, 8)}]`);
      status = added ? "executed" : "failed";
      if (added) receipt = { job_id: text(target.job_id), reconciled: true };
      else error = "The note was not added.";
    }
    const { data: settled } = await db
      .from("task_proposals")
      .update({ status, receipt, error, executed_at: now.toISOString() })
      .eq("id", id)
      .eq("status", "executing")
      .select("id")
      .maybeSingle();
    if (!settled) continue;
    tally[status] += 1;
    if (status === "uncertain") {
      const { data: execution } = await db.from("task_executions").select("requested_by").eq("id", text(proposal.execution_id)).maybeSingle();
      await updateExecution(db, text(proposal.execution_id), { status: "failed", stage: "Outcome unknown", error, finished_at: now.toISOString() }, ["running", "waiting_approval", "cancel_requested"]);
      await systemTaskUpdate(db, text(proposal.organization_id), text(proposal.task_id), { status: "todo" });
      await activity(db, text(proposal.organization_id), text(proposal.task_id), "action_uncertain", { proposal_id: id }, "system");
      await notify(db, {
        organizationId: text(proposal.organization_id),
        userId: text((execution as Row | null)?.requested_by) || null,
        taskId: text(proposal.task_id),
        kind: "failure",
        title: "Check whether a text went out",
        body: error ?? undefined,
        key: `uncertain:${id}`,
      });
    } else {
      await afterAction(db, deps, proposal, { ok: status === "executed", message: status === "executed" ? "Confirmed from the record it left." : (error ?? "Not done.") }, status === "executed");
    }
  }
  return tally;
}

/** Work that was asked to stop while running, and whose run has ended without noticing: settle it. */
export async function settleCancelRequests(db: Database, deps: AssistantDeps): Promise<number> {
  const now = clock(deps);
  const cutoff = new Date(now.getTime() - 5 * 60_000).toISOString();
  const { data } = await db.from("task_executions").select("id, organization_id, task_id").eq("status", "cancel_requested").lte("cancel_requested_at", cutoff).limit(50);
  let settled = 0;
  for (const row of rows(data)) {
    const done = await updateExecution(db, text(row.id), { status: "canceled", stage: "Stopped", finished_at: now.toISOString() }, ["cancel_requested"]);
    if (done) {
      settled += 1;
      await db.from("task_work").update({ status: "canceled", finished_at: now.toISOString() }).eq("execution_id", text(row.id)).eq("status", "pending");
    }
  }
  return settled;
}

export { taskUrl };
