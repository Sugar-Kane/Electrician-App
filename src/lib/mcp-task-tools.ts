import type { McpTool, ToolResult } from "./mcp-protocol.ts";
import { BULK_MAX, TASK_FILTERS, TASK_STATUSES, TASK_VIEWS, isTaskFilter, isTaskStatus, isTaskView, type Result } from "./task-rules.ts";
import {
  archiveTask,
  completeTask,
  createTask,
  createTasks,
  getTask,
  linkTaskToJob,
  listTasks,
  reopenTask,
  sayDate,
  unlinkTaskFromJob,
  updateTask,
  type Actor,
  type CreateInput,
  type TaskSummary,
} from "./tasks-service.ts";
import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";
import { dayJob, dayJobs } from "./job-todos.ts";

/**
 * Tasks from ChatGPT or Claude. These tools call the same service as the
 * Tasks page and the job page, so a task made here is the task Volteira shows,
 * and a change made in Volteira is what the next call here reads back. There
 * is no second list to keep in step.
 *
 * Volteira cannot push into a conversation: an answer already shown in ChatGPT
 * does not change when the task does. Ask again for the current state.
 *
 * Tasks are Volteira's own records and nothing is sent to anybody, so making
 * and changing them needs no confirmation step. Archiving keeps the task and
 * its history.
 */

const str = (description: string) => ({ type: "string", description });
const version = {
  type: "number",
  description: "The task's version from the last time you read it. If someone changed the task since, the change is refused and you should read it again.",
};
const taskId = str("The task's id, from create_task, list_tasks or get_task.");
const dueFields = {
  due_date: str("When the outcome is needed, YYYY-MM-DD, worked out in the business's time zone (list_tasks returns today's date). A due date never starts anything by itself. Empty string clears it."),
  due_time: str("Optional time on the due date, 24-hour HH:MM. Needs a due date. Ask if the time is unclear. Empty string clears it."),
  notes: str("Optional notes."),
  reminder_at: str("Optional reminder, local time YYYY-MM-DDTHH:MM in the business's time zone (separate from the due date). The user is notified in Volteira then. Must be in the future. Empty string clears it."),
};
const repeat = {
  type: "object",
  description:
    "Makes it repeat. Needs a due date (the first time). Daily, weekly (weekdays 0=Sun..6=Sat) or monthly (monthday 1-31; months without that day use their last day). Optional interval (every N), until (YYYY-MM-DD) or count. Each time is its own task; the next ones appear a week ahead.",
  properties: {
    freq: { type: "string", enum: ["daily", "weekly", "monthly"] },
    interval: { type: "number" },
    weekdays: { type: "array", items: { type: "number" } },
    monthday: { type: "number" },
    until: { type: "string" },
    count: { type: "number" },
  },
  required: ["freq"],
  additionalProperties: false,
};

export const TASK_MCP_TOOLS: McpTool[] = [
  {
    name: "daily_task_list",
    title: "Daily task list",
    description:
      "The user's daily list in one call: their tasks (overdue, due today, waiting on them), today's jobs in time order, and NEEDS YOUR ACTION, the same list as Volteira's home screen (past visits to confirm, quotes to price, invoices to send or chase, booking requests, finished work to invoice, estimates awaiting approval, buy list, restocking). Use for 'what's on my list today', 'my tasks', or a morning briefing. Each item says where it gets done; offer to do the next one.",
    inputSchema: {
      type: "object",
      properties: { date: str("Optional day, YYYY-MM-DD in the business's time zone. Defaults to today.") },
      additionalProperties: false,
    },
  },
  {
    name: "create_task",
    title: "Create task",
    description:
      "Save one task in Volteira. Only a title is needed. Optionally link it to a job (job number like 1042, or customer name; if several jobs match you'll be asked which). A task without a job is private to the user and assigned to them; a task on a job is visible to everyone in the business. Returns the task with its id and a link. Do not invent dates, times or jobs the user did not give.",
    inputSchema: {
      type: "object",
      properties: {
        title: str("What needs doing, in a few words."),
        ...dueFields,
        job: str("Optional job: its number (1042) or the customer's name."),
        repeat,
        request_id: str("Optional id for this request. Send the same one when retrying so the task is not made twice."),
      },
      required: ["title"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "create_tasks",
    title: "Create several tasks",
    description:
      `Save several tasks from one request (up to ${BULK_MAX}), e.g. "order the panel tomorrow, confirm the appointment Friday, and prepare permit paperwork". A job given at the top applies to all of them. Each task is made or refused on its own; the result lists each one's outcome. Send a request_id so a retry does not duplicate them.`,
    inputSchema: {
      type: "object",
      properties: {
        tasks: {
          type: "array",
          minItems: 1,
          maxItems: BULK_MAX,
          items: {
            type: "object",
            properties: { title: str("What needs doing."), ...dueFields, job: str("Optional job for just this task.") },
            required: ["title"],
            additionalProperties: false,
          },
        },
        job: str("Optional job for all of them: its number or the customer's name."),
        request_id: str("Optional id for this request, reused on retry."),
      },
      required: ["tasks"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "list_tasks",
    title: "List tasks",
    description:
      "The user's tasks in Volteira, current as of now. Views: today (due today, overdue, or waiting on the user), upcoming (due later, by date), all (every open task, dated or not), completed. Filter by job (number or customer name), status, filters (mine, ai, waiting_input, waiting_approval, overdue), words, or due-date range. Also returns today's date and the time zone, for working out relative dates. Unless the view is completed, it also returns NEEDS YOUR ACTION: the jobs' own to-dos, the same list as Volteira's home screen (past visits to confirm, quotes to price, invoices to send or chase, booking requests, and so on). When reporting what the user has to do, include both; never say they're caught up while that list has items.",
    inputSchema: {
      type: "object",
      properties: {
        view: { type: "string", enum: [...TASK_VIEWS], description: "Defaults to all." },
        job: str("Optional job number or customer name."),
        status: { type: "string", enum: [...TASK_STATUSES] },
        filters: { type: "array", items: { type: "string", enum: [...TASK_FILTERS] } },
        search: str("Words in the title or notes."),
        due_from: str("Earliest due date, YYYY-MM-DD."),
        due_to: str("Latest due date, YYYY-MM-DD."),
        limit: { type: "number", description: "1 to 100. Defaults to 25." },
        offset: { type: "number", description: "From next_offset of the previous page." },
      },
      required: [],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "get_task",
    title: "Get task",
    description: "One task in full, with its job, assignee, version and recent history.",
    inputSchema: { type: "object", properties: { task_id: taskId }, required: ["task_id"], additionalProperties: false },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "update_task",
    title: "Update task",
    description:
      "Change a task's title, notes, due date or time, reminder, repeat, status (todo, in_progress, waiting_input, waiting_approval, complete, canceled) or assignee. Only the fields given change. For a repeating task, say apply_to. Use link_task_to_job to change its job.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: taskId,
        title: str("New title."),
        ...dueFields,
        status: { type: "string", enum: [...TASK_STATUSES] },
        assignee_user_id: str("A team member's user id, or empty string to unassign."),
        repeat: { ...repeat, description: "A new repeat rule. Always applies to this and future occurrences (apply_to future)." },
        stop_repeating: { type: "boolean", description: "True to stop the task repeating from here on (apply_to future). Earlier and current occurrences stay." },
        apply_to: {
          type: "string",
          enum: ["this", "future"],
          description: "Required when the task repeats: 'this' changes only this occurrence; 'future' changes this one and the ones after it. Ask the user if unclear. Past occurrences never change.",
        },
        version,
      },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "complete_task",
    title: "Complete task",
    description: "Mark a task complete, optionally with a short note of what was done. Completing a task never completes its job.",
    inputSchema: {
      type: "object",
      properties: { task_id: taskId, summary: str("Optional note of what was done."), version },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "reopen_task",
    title: "Reopen task",
    description: "Reopen a completed or canceled task. Never reopens its job.",
    inputSchema: { type: "object", properties: { task_id: taskId, version }, required: ["task_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  },
  {
    name: "archive_task",
    title: "Archive task",
    description: "Archive a task: it leaves the lists but is kept with its history, and can be restored. Set restore true to bring an archived task back.",
    inputSchema: {
      type: "object",
      properties: { task_id: taskId, restore: { type: "boolean", description: "Bring an archived task back." }, version },
      required: ["task_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "link_task_to_job",
    title: "Link task to job",
    description:
      "Put a task on a job, or move it to another job. The task keeps its history; the job itself is not changed. A private task becomes visible to everyone in the business when linked: if that applies, the tool refuses and explains, and you must tell the user and only retry with confirm_visibility_change true once they agree.",
    inputSchema: {
      type: "object",
      properties: {
        task_id: taskId,
        job: str("The job number or customer name."),
        confirm_visibility_change: { type: "boolean", description: "True only after the user agreed to make a private task visible to the business." },
        version,
      },
      required: ["task_id", "job"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "unlink_task_from_job",
    title: "Unlink task from job",
    description: "Take a task off its job without deleting it.",
    inputSchema: { type: "object", properties: { task_id: taskId, version }, required: ["task_id"], additionalProperties: false },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const NAMES = new Set(TASK_MCP_TOOLS.map((tool) => tool.name));
export function isTaskTool(name: string): boolean {
  return NAMES.has(name);
}

type Args = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function optionalVersion(args: Args): number | undefined {
  return typeof args.version === "number" && Number.isInteger(args.version) ? args.version : undefined;
}

/** One line a person can read back: what, when, which job, who, where it stands. */
export function describeTask(task: TaskSummary): string {
  const parts = [`"${task.title}"`, task.status_label];
  if (task.due_date) parts.push(`due ${sayDate(task.due_date)}${task.due_time ? ` at ${task.due_time}` : ""} (${task.time_zone})${task.overdue ? ", OVERDUE" : ""}`);
  if (task.reminder_label) parts.push(`reminder ${task.reminder_label}${task.reminder_sent ? " (sent)" : ""}`);
  if (task.repeat) parts.push(`repeats: ${task.repeat.description}${task.repeat.active ? "" : " (stopped)"}`);
  if (task.job) parts.push(`job ${task.job.label}`);
  if (task.assignee.name) parts.push(`assigned to ${task.assignee.name}`);
  parts.push(task.visibility === "private" ? "private" : "shared with the business");
  return `${parts.join(" | ")} | id ${task.id} | v${task.version} | ${task.url}`;
}

function failure(result: Extract<Result<unknown>, { ok: false }>): ToolResult {
  return { isError: true, text: `${result.error.message} [${result.error.code}]`, structured: { error: result.error } };
}

function one(task: TaskSummary, lead: string): ToolResult {
  return { text: `${lead}\n${describeTask(task)}`, structured: { task } };
}

function createInput(item: Args): CreateInput {
  return {
    title: item.title,
    notes: item.notes,
    due_date: item.due_date,
    due_time: item.due_time,
    reminder_at: item.reminder_at,
    ...(item.repeat !== undefined ? { repeat: item.repeat } : {}),
    ...(text(item.job) ? { job: text(item.job) } : {}),
  };
}

/**
 * Run a task tool for an actor the route has already verified: the person who
 * created this connection, still a member of the business.
 */
/** The home screen's "Needs your action", handed in by the route (it reads server-only data). */
export type NeedsActionSource = () => Promise<{ lines: string[]; items: unknown[] }>;

export async function runTaskTool(input: {
  database: FlexibleSupabaseClient;
  actor: Actor | null;
  name: string;
  args: Args;
  needsAction?: NeedsActionSource;
}): Promise<ToolResult> {
  const { database: db, actor, name, args } = input;
  if (!actor) {
    return {
      isError: true,
      text: "Tasks need a connection made by a current team member. Make a new link in Volteira: Settings → Use in ChatGPT or Claude. [NOT_CONNECTED]",
      structured: { error: { code: "NOT_CONNECTED", message: "Reconnect from Volteira to use tasks." } },
    };
  }
  const id = text(args.task_id);

  switch (name) {
    case "daily_task_list": {
      const [plan, needs] = await Promise.all([
        dayJobs(db, actor.organizationId, actor.timeZone, text(args.date) || undefined),
        input.needsAction ? input.needsAction() : Promise.resolve({ lines: [] as string[], items: [] as unknown[] }),
      ]);
      const isToday = plan.date === plan.today;
      const listed = await listTasks(db, actor, isToday ? { view: "today", limit: 50 } : { view: "all", from: plan.date, to: plan.date, limit: 50 });
      if (!listed.ok) return failure(listed);
      const tasks = listed.value.tasks;
      const jobs = plan.jobs.map((job) => dayJob(job, actor.timeZone));
      const lines: string[] = [`Daily list for ${sayDate(plan.date)}${isToday ? " (today)" : ""} | time zone ${actor.timeZone}`, ""];
      lines.push(tasks.length ? `YOUR TASKS (${tasks.length})` : "YOUR TASKS: nothing due, overdue or waiting on you.");
      tasks.forEach((task) => lines.push(`- ${describeTask(task)}`));
      lines.push("", jobs.length ? `JOBS (${jobs.length})` : "JOBS: nothing scheduled.");
      jobs.forEach((job) => lines.push(`- ${job.window} | #${job.number} ${job.kind} | ${job.status} | ${job.customer}${job.address ? ` | ${job.address}` : ""} | parts ${job.partsReady ? "ready" : "not marked ready"}`));
      if (needs.lines.length) lines.push("", ...needs.lines);
      return { text: lines.join("\n"), structured: { date: plan.date, today: plan.today, time_zone: actor.timeZone, tasks, jobs, needs_your_action: needs.items } };
    }
    case "create_task": {
      const made = await createTask(db, actor, { ...createInput(args), idempotency_key: text(args.request_id) || undefined });
      if (!made.ok) return failure(made);
      return one(made.value.task, made.value.created ? "Task saved in Volteira." : "That task was already saved for this request; nothing new was made.");
    }
    case "create_tasks": {
      const items = Array.isArray(args.tasks) ? (args.tasks as Args[]) : [];
      const made = await createTasks(db, actor, items.map(createInput), { job: text(args.job) || undefined, request_key: text(args.request_id) || undefined });
      if (!made.ok) return failure(made);
      const lines = made.value.results.map((result) =>
        result.ok ? `${result.index + 1}. ${result.created ? "Saved" : "Already saved"}: ${describeTask(result.task)}` : `${result.index + 1}. Not saved: ${result.error.message} [${result.error.code}]`,
      );
      const saved = made.value.results.filter((result) => result.ok).length;
      return {
        text: `${saved} of ${made.value.results.length} tasks saved in Volteira.\n${lines.join("\n")}`,
        structured: { results: made.value.results },
        isError: saved === 0,
      };
    }
    case "list_tasks": {
      const view = isTaskView(text(args.view)) ? (text(args.view) as never) : "all";
      const filters = (Array.isArray(args.filters) ? args.filters : []).map(text).filter(isTaskFilter);
      const status = isTaskStatus(text(args.status)) ? (text(args.status) as never) : undefined;
      const limit = Math.min(Math.max(Number(args.limit) || 25, 1), 100);
      const listed = await listTasks(db, actor, {
        view,
        filters,
        status,
        job: text(args.job) || undefined,
        q: text(args.search) || undefined,
        from: text(args.due_from) || undefined,
        to: text(args.due_to) || undefined,
        limit,
        offset: Number(args.offset) || 0,
      });
      if (!listed.ok) return failure(listed);
      const { tasks, total, next_offset, today, time_zone } = listed.value;
      const head = `Today is ${sayDate(today)} (${time_zone}). ${total} task${total === 1 ? "" : "s"} in "${view}"${filters.length ? ` filtered by ${filters.join(", ")}` : ""}.`;
      const body = tasks.length ? tasks.map((task) => `- ${describeTask(task)}`).join("\n") : "Nothing here.";
      const more = next_offset !== null ? `\nMore: call again with offset ${next_offset}.` : "";
      // Tasks people wrote are one half of what needs doing; the jobs' own
      // "Needs your action" (the home screen's list) is the other. Both go
      // back, so "no tasks" is never mistaken for "nothing to do".
      const needs = String(view) !== "completed" && input.needsAction ? await input.needsAction() : null;
      const also = needs && needs.items.length ? `\n\n${needs.lines.join("\n")}` : "";
      return { text: `${head}\n${body}${more}${also}`, structured: { ...listed.value, ...(needs ? { needs_your_action: needs.items } : {}) } };
    }
    case "get_task": {
      const found = await getTask(db, actor, id);
      if (!found.ok) return failure(found);
      const history = found.value.activity
        .slice(0, 10)
        .map((item) => `- ${item.created_at.slice(0, 16).replace("T", " ")} ${item.event} by ${item.actor_name ?? item.actor_type}${item.via === "chatgpt" ? " (via ChatGPT/Claude)" : ""}`)
        .join("\n");
      const notes = found.value.task.notes ? `\nNotes: ${found.value.task.notes.replace(/\s+/g, " ").slice(0, 1500)}` : "";
      return {
        text: `${describeTask(found.value.task)}${notes}\nHistory:\n${history || "- none"}`,
        structured: { task: found.value.task, activity: found.value.activity },
      };
    }
    case "update_task": {
      const changed = await updateTask(
        db,
        actor,
        id,
        {
          ...(args.title !== undefined ? { title: args.title } : {}),
          ...(args.notes !== undefined ? { notes: args.notes } : {}),
          ...(args.due_date !== undefined ? { due_date: args.due_date } : {}),
          ...(args.due_time !== undefined ? { due_time: args.due_time } : {}),
          ...(args.status !== undefined ? { status: text(args.status) } : {}),
          ...(args.assignee_user_id !== undefined ? { assignee_user_id: text(args.assignee_user_id) } : {}),
          ...(args.reminder_at !== undefined ? { reminder_at: args.reminder_at } : {}),
          ...(args.stop_repeating === true ? { repeat: null } : args.repeat !== undefined ? { repeat: args.repeat } : {}),
        },
        optionalVersion(args),
        { scope: args.apply_to === "this" || args.apply_to === "future" ? args.apply_to : undefined },
      );
      return changed.ok ? one(changed.value, "Task updated in Volteira.") : failure(changed);
    }
    case "complete_task": {
      const done = await completeTask(db, actor, id, optionalVersion(args), text(args.summary) || undefined);
      return done.ok ? one(done.value, "Task completed. Its job, if any, was not changed.") : failure(done);
    }
    case "reopen_task": {
      const reopened = await reopenTask(db, actor, id, optionalVersion(args));
      return reopened.ok ? one(reopened.value, "Task reopened.") : failure(reopened);
    }
    case "archive_task": {
      const restore = args.restore === true;
      const archived = await archiveTask(db, actor, id, optionalVersion(args), restore);
      return archived.ok ? one(archived.value, restore ? "Task restored." : "Task archived. It is kept with its history and can be restored.") : failure(archived);
    }
    case "link_task_to_job": {
      const linked = await linkTaskToJob(db, actor, id, text(args.job), { confirmVisibility: args.confirm_visibility_change === true, version: optionalVersion(args) });
      return linked.ok ? one(linked.value, "Task linked to the job. The job itself was not changed.") : failure(linked);
    }
    case "unlink_task_from_job": {
      const unlinked = await unlinkTaskFromJob(db, actor, id, optionalVersion(args));
      return unlinked.ok ? one(unlinked.value, "Task taken off its job. The task was kept.") : failure(unlinked);
    }
    default:
      return { isError: true, text: `Unknown task tool: ${name}` };
  }
}
