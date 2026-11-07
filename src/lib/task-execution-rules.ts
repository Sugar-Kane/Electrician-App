import { fail, isClosed, type Result } from "./task-rules.ts";

/**
 * The rules for assistant work on a task, with no database: its states, what
 * needs a person's approval, and whether an approval still holds.
 *
 * Permissions come only from the person who started the work (the mode they
 * chose) and from these rules. Nothing the task says and nothing the assistant
 * writes can widen them: the assistant can only propose the action types
 * below, its target is resolved by the server, and texting a customer always
 * needs a person's approval.
 */

export const EXECUTION_STATUSES = [
  "queued",
  "running",
  "waiting_input",
  "waiting_approval",
  "succeeded",
  "failed",
  "cancel_requested",
  "canceled",
] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXECUTION_LABELS: Record<ExecutionStatus, string> = {
  queued: "Queued",
  running: "Working",
  waiting_input: "Needs your answer",
  waiting_approval: "Needs your approval",
  succeeded: "Done",
  failed: "Failed",
  cancel_requested: "Stopping",
  canceled: "Canceled",
};

const ACTIVE: ReadonlySet<string> = new Set(["queued", "running", "waiting_input", "waiting_approval", "cancel_requested"]);

export function isActiveExecution(status: string): boolean {
  return ACTIVE.has(status);
}

export const PERMISSION_MODES = ["prepare", "execute_approved"] as const;
export type PermissionMode = (typeof PERMISSION_MODES)[number];
export const PERMISSION_LABELS: Record<PermissionMode, string> = {
  prepare: "Prepare for my review: nothing is done until I approve it",
  execute_approved: "Add job notes by itself; ask me before anything else",
};

/** What the assistant may propose. Anything else (payments, purchases, deleting, settings) it cannot do at all. */
export const ACTION_TYPES = ["send_text", "add_job_note"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];
export const ACTION_LABELS: Record<ActionType, string> = {
  send_text: "Text the customer",
  add_job_note: "Add a note to the job",
};

export function isActionType(value: string): value is ActionType {
  return (ACTION_TYPES as readonly string[]).includes(value);
}

/** Texting a customer always needs a person. A job note can be pre-authorized by the person who started the work. */
export function needsApproval(action: ActionType, mode: PermissionMode): boolean {
  if (action === "send_text") return true;
  return mode !== "execute_approved";
}

/** How long an action waits for a decision before it can no longer be approved. */
export const APPROVAL_WINDOW_HOURS = 24;
/** Model calls per run, counting answers and revisions, so work cannot loop forever. */
export const MAX_ROUNDS = 6;
/** A worker run that starts the same execution this many times gives up. */
export const MAX_ATTEMPTS = 3;

/** What happens when somebody stops the work: right away, or at the runner's next check. */
export function cancelOutcome(status: string): Result<"canceled" | "cancel_requested"> {
  if (status === "running") return { ok: true, value: "cancel_requested" };
  if (status === "queued" || status === "waiting_input" || status === "waiting_approval") return { ok: true, value: "canceled" };
  if (status === "cancel_requested") return fail("INVALID_INPUT", "That work is already stopping.");
  return fail("INVALID_INPUT", "That work has already finished.");
}

export type ProposalFacts = {
  status: string;
  version: number;
  content_hash: string;
  task_version: number;
  expires_at: string;
};

/**
 * Whether an approval can be accepted: still pending, not run out, for the
 * version and content the person saw, and the task not changed since.
 */
export function approvalCheck(
  proposal: ProposalFacts,
  task: { version: number; status: string; archived_at: string | null },
  given: { version?: number; content_hash?: string },
  now: Date = new Date(),
): Result<true> {
  if (proposal.status !== "pending") {
    return fail("INVALID_INPUT", proposal.status === "approved" || proposal.status === "executing" || proposal.status === "executed" ? "That action was already approved." : "That action is no longer waiting for approval.");
  }
  if (Date.parse(proposal.expires_at) <= now.getTime()) return fail("PROPOSAL_EXPIRED", "That proposal ran out without a decision. Start the work again for a fresh one.");
  if (!given.content_hash || given.content_hash !== proposal.content_hash) {
    return fail("PROPOSAL_CHANGED", "That is not the version of the action waiting for approval. Look at it again before approving.");
  }
  if (given.version !== undefined && given.version !== proposal.version) {
    return fail("PROPOSAL_CHANGED", "That is not the version of the action waiting for approval. Look at it again before approving.");
  }
  if (task.archived_at || isClosed(task.status)) return fail("INVALID_INPUT", "The task is closed, so nothing will be done.");
  if (task.version !== proposal.task_version) {
    return fail("PROPOSAL_CHANGED", "The task changed after this was proposed, so the approval no longer fits. Start the work again.");
  }
  return { ok: true, value: true };
}

/**
 * Who may approve or reject what an assistant proposes: the person who
 * started the work, the task's owner or creator, or an owner or admin of the
 * business. Anyone else who can see the task can read it, not decide it.
 */
export function canDecide(
  actor: { userId: string; role: string },
  task: { owner_id?: unknown; created_by?: unknown },
  execution: { requested_by?: unknown },
): boolean {
  if (actor.role === "owner" || actor.role === "admin") return true;
  return [execution.requested_by, task.owner_id, task.created_by].some((id) => typeof id === "string" && id === actor.userId);
}

export type AssignInput = {
  connection_id?: string;
  instructions: string;
  completion_criteria: string | null;
  permission_mode: PermissionMode;
  start: "now" | "scheduled" | "later";
  scheduled_at: string | null;
};

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

export function readAssignInput(args: Record<string, unknown>, now: Date = new Date()): Result<AssignInput> {
  const instructions = clean(args.instructions, 10_000);
  if (!instructions) return fail("INVALID_INPUT", "Say what the assistant should do.", "instructions");
  const mode = clean(args.permission_mode, 40) || "prepare";
  if (!(PERMISSION_MODES as readonly string[]).includes(mode)) return fail("INVALID_INPUT", "The permission mode is prepare or execute_approved.", "permission_mode");
  const start = clean(args.start, 20) || "now";
  if (!["now", "scheduled", "later"].includes(start)) return fail("INVALID_INPUT", "Start is now, scheduled or later.", "start");
  let scheduled: string | null = null;
  if (start === "scheduled") {
    const when = Date.parse(clean(args.scheduled_at, 60));
    if (!Number.isFinite(when)) return fail("INVALID_INPUT", "Give the time to start, with its time zone.", "scheduled_at");
    if (when <= now.getTime()) return fail("INVALID_INPUT", "The start time has to be in the future.", "scheduled_at");
    scheduled = new Date(when).toISOString();
  }
  return {
    ok: true,
    value: {
      connection_id: clean(args.connection_id, 60) || undefined,
      instructions,
      completion_criteria: clean(args.completion_criteria, 2000) || null,
      permission_mode: mode as PermissionMode,
      start: start as AssignInput["start"],
      scheduled_at: scheduled,
    },
  };
}
