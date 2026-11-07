import type { McpTool, ToolResult } from "./mcp-protocol.ts";
import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";
import { readAssignInput } from "./task-execution-rules.ts";
import {
  answerExecution,
  approveProposal,
  assignToAssistant,
  cancelExecution,
  getExecution,
  listAssistants,
  rejectProposal,
  startExecution,
  type AssistantDeps,
  type ExecutionView,
} from "./task-executions.ts";
import type { Result } from "./task-rules.ts";
import type { Actor, TaskSummary } from "./tasks-service.ts";

/**
 * Assistant work on tasks from ChatGPT or Claude: hand a task to Volteira's
 * assistant, follow it, answer its questions, and approve or turn down what it
 * proposes. The same service as the task page, under the same rules.
 *
 * Approving here is a person's approval, given through their own connection:
 * it needs the proposal's id and the content hash that get_task_execution
 * returned, so it covers exactly the content that was shown.
 */

const str = (description: string) => ({ type: "string", description });

export const TASK_ASSISTANT_MCP_TOOLS: McpTool[] = [
  {
    name: "list_task_assistants",
    title: "List task assistants",
    description:
      "The assistants this business can hand tasks to, each with its state: ready, connection_required (cannot take work yet) or disabled. Only a ready one can be used. No credentials are ever returned.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "assign_task_to_ai",
    title: "Assign task to AI",
    description:
      "Hand a task to Volteira's assistant with instructions. The assistant reads the task and its job, then finishes, asks a question, or proposes an action (texting the job's customer, or adding a job note). Texting a customer always waits for the user's approval. permission_mode prepare (default) means nothing is done without approval; execute_approved lets it add job notes by itself. start: now (default, begins within a minute), scheduled (needs scheduled_at), or later.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: str("The task's id."),
        instructions: str("What the assistant should do, in the user's words."),
        completion_criteria: str("Optional: what done looks like."),
        permission_mode: { type: "string", enum: ["prepare", "execute_approved"] },
        start: { type: "string", enum: ["now", "scheduled", "later"] },
        scheduled_at: str("For start=scheduled: ISO date-time with offset, in the future."),
        connection_id: str("Optional assistant id from list_task_assistants. Defaults to Volteira's own."),
        version: { type: "number", description: "The task's version from your last read." },
        request_id: str("Optional id for this request; send the same one on a retry."),
      },
      required: ["task_id", "instructions"],
      additionalProperties: false,
    },
  },
  {
    name: "start_task_execution",
    title: "Start task execution",
    description: "Start the assistant again on a task already assigned to it (for example after it finished, failed or was stopped). One run at a time per task.",
    inputSchema: {
      type: "object",
      properties: { task_id: str("The task's id."), request_id: str("Optional id for this request; send the same one on a retry.") },
      required: ["task_id"],
      additionalProperties: false,
    },
  },
  {
    name: "get_task_execution",
    title: "Get task execution",
    description:
      "Where the assistant's work on a task stands: status, stage, its question, its result, and any action waiting for approval with its exact content, proposal_id, version and content_hash. Show the user the exact content before they approve.",
    inputSchema: {
      type: "object",
      properties: { task_id: str("The task's id (gives its latest run)."), execution_id: str("Or a specific run's id.") },
      additionalProperties: false,
    },
  },
  {
    name: "answer_task_question",
    title: "Answer task question",
    description: "Give the assistant the user's answer to its question. Send only what the user said; do not answer for them.",
    inputSchema: {
      type: "object",
      properties: { execution_id: str("The run's id."), answer: str("The user's answer.") },
      required: ["execution_id", "answer"],
      additionalProperties: false,
    },
  },
  {
    name: "approve_task_action",
    title: "Approve task action",
    description:
      "Approve and carry out one action the assistant proposed, such as a text to the customer. Call only after showing the user the exact content from get_task_execution and the user explicitly approving it in this conversation. Needs the proposal_id and content_hash from get_task_execution; if the content or the task changed, the approval is refused.",
    inputSchema: {
      type: "object",
      properties: {
        proposal_id: str("The proposal's id."),
        content_hash: str("The content_hash shown with that proposal."),
        proposal_version: { type: "number", description: "The proposal's version shown with it." },
      },
      required: ["proposal_id", "content_hash"],
      additionalProperties: false,
    },
  },
  {
    name: "reject_task_action",
    title: "Reject task action",
    description: "Turn down an action the assistant proposed (it stops), or set revise=true with a note to have it propose a new version.",
    inputSchema: {
      type: "object",
      properties: {
        proposal_id: str("The proposal's id."),
        note: str("Why, or what to change. Needed with revise."),
        revise: { type: "boolean", description: "True to ask for a new version instead of stopping." },
      },
      required: ["proposal_id"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_task_execution",
    title: "Cancel task execution",
    description: "Stop the assistant's work on a task. Queued or waiting work stops at once; work in progress stops before it does anything else.",
    inputSchema: {
      type: "object",
      properties: { execution_id: str("The run's id.") },
      required: ["execution_id"],
      additionalProperties: false,
    },
  },
];

const NAMES = new Set(TASK_ASSISTANT_MCP_TOOLS.map((tool) => tool.name));
export function isTaskAssistantTool(name: string): boolean {
  return NAMES.has(name);
}

type Args = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function failure(result: Extract<Result<unknown>, { ok: false }>): ToolResult {
  return { isError: true, text: `${result.error.message} [${result.error.code}]`, structured: { error: result.error } };
}

export function describeExecution(execution: ExecutionView | null): string {
  if (!execution) return "No assistant work on this task yet.";
  const lines = [`Assistant work ${execution.id}: ${execution.status_label}${execution.stage ? ` (${execution.stage})` : ""}`];
  if (execution.question && execution.status === "waiting_input") lines.push(`Question for the user: ${execution.question}`);
  if (execution.result_summary) lines.push(`Result: ${execution.result_summary}`);
  if (execution.error) lines.push(`Problem: ${execution.error}`);
  const waiting = execution.proposals.find((proposal) => proposal.status === "pending");
  if (waiting) {
    lines.push(
      `Waiting for approval: ${waiting.action_label} → ${waiting.target_label}`,
      `Exact content: "${waiting.content}"`,
      waiting.reason ? `Why: ${waiting.reason}` : "",
      `proposal_id ${waiting.id} | version ${waiting.version} | content_hash ${waiting.content_hash} | expires ${waiting.expires_at}`,
    );
  }
  for (const done of execution.proposals.filter((proposal) => ["executed", "failed", "uncertain"].includes(proposal.status)).slice(0, 3)) {
    lines.push(`${done.action_label}: ${done.status}${done.error ? ` (${done.error})` : ""}`);
  }
  return lines.filter(Boolean).join("\n");
}

function withTask(task: TaskSummary, execution: ExecutionView | null, lead: string): ToolResult {
  return {
    text: `${lead}\nTask "${task.title}" | ${task.status_label} | id ${task.id} | v${task.version} | ${task.url}\n${describeExecution(execution)}`,
    structured: { task, execution },
  };
}

export async function runTaskAssistantTool(input: {
  database: FlexibleSupabaseClient;
  actor: Actor | null;
  deps: AssistantDeps;
  name: string;
  args: Args;
  /** Called when work was queued, so it can start straight away. */
  onQueued?: () => void;
}): Promise<ToolResult> {
  const { database: db, actor, deps, name, args } = input;
  if (!actor) {
    return {
      isError: true,
      text: "Tasks need a connection made by a current team member. Make a new link in Volteira: Settings → Use in ChatGPT or Claude. [NOT_CONNECTED]",
      structured: { error: { code: "NOT_CONNECTED", message: "Reconnect from Volteira to use tasks." } },
    };
  }

  switch (name) {
    case "list_task_assistants": {
      const assistants = await listAssistants(db, actor, deps);
      const body = assistants.length ? assistants.map((item) => `- ${item.name} (${item.state}): ${item.note} | id ${item.id}`).join("\n") : "No assistants are connected to this business.";
      return { text: body, structured: { assistants } };
    }
    case "assign_task_to_ai": {
      const read = readAssignInput(args);
      if (!read.ok) return failure(read);
      const assigned = await assignToAssistant(db, actor, deps, text(args.task_id), read.value, {
        version: typeof args.version === "number" ? args.version : undefined,
        request_id: text(args.request_id) || undefined,
      });
      if (!assigned.ok) return failure(assigned);
      if (assigned.value.execution) input.onQueued?.();
      return withTask(assigned.value.task, assigned.value.execution, assigned.value.execution ? "Assigned to the assistant. It starts within a minute (or at the scheduled time)." : "Assigned to the assistant. It will start when asked.");
    }
    case "start_task_execution": {
      const started = await startExecution(db, actor, deps, text(args.task_id), { request_id: text(args.request_id) || undefined });
      if (!started.ok) return failure(started);
      input.onQueued?.();
      return withTask(started.value.task, started.value.execution, "Started. The assistant begins within a minute.");
    }
    case "get_task_execution": {
      const found = await getExecution(db, actor, { task_id: text(args.task_id) || undefined, execution_id: text(args.execution_id) || undefined });
      return found.ok ? withTask(found.value.task, found.value.execution, "") : failure(found);
    }
    case "answer_task_question": {
      const answered = await answerExecution(db, actor, deps, text(args.execution_id), text(args.answer));
      if (!answered.ok) return failure(answered);
      input.onQueued?.();
      return { text: `Answer passed on. The assistant continues within a minute.\n${describeExecution(answered.value.execution)}`, structured: { execution: answered.value.execution } };
    }
    case "approve_task_action": {
      const approved = await approveProposal(db, actor, deps, text(args.proposal_id), {
        content_hash: text(args.content_hash),
        version: typeof args.proposal_version === "number" ? args.proposal_version : undefined,
      });
      if (!approved.ok) return failure(approved);
      if (approved.value.execution?.status === "queued") input.onQueued?.();
      return {
        isError: !["executed"].includes(approved.value.proposal.status),
        text: `${approved.value.message}\n${describeExecution(approved.value.execution)}`,
        structured: { proposal: approved.value.proposal, execution: approved.value.execution },
      };
    }
    case "reject_task_action": {
      const rejected = await rejectProposal(db, actor, deps, text(args.proposal_id), { note: text(args.note), revise: args.revise === true });
      if (!rejected.ok) return failure(rejected);
      if (rejected.value.execution?.status === "queued") input.onQueued?.();
      return { text: `${rejected.value.message}\n${describeExecution(rejected.value.execution)}`, structured: { execution: rejected.value.execution } };
    }
    case "cancel_task_execution": {
      const canceled = await cancelExecution(db, actor, deps, text(args.execution_id));
      if (!canceled.ok) return failure(canceled);
      return { text: `${canceled.value.message}\n${describeExecution(canceled.value.execution)}`, structured: { execution: canceled.value.execution } };
    }
    default:
      return { isError: true, text: `Unknown tool: ${name}` };
  }
}
