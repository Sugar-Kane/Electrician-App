import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";
import {
  BULK_MAX,
  TASK_STATUS_LABELS,
  completeTransition,
  dueLabel,
  fail,
  inView,
  isClosed,
  isOverdue,
  isTaskStatus,
  matchesFilter,
  readTaskFields,
  reopenTransition,
  todayIn,
  visibilityForJobLink,
  weekdayOf,
  type Result,
  type TaskFilter,
  type TaskInput,
  type TaskStatus,
  type TaskView,
  type TaskVisibility,
} from "./task-rules.ts";

/**
 * The one service behind every way into tasks: the Tasks page, each job's
 * Tasks section and the ChatGPT/Claude connection all call these functions,
 * so they read and write the same rows under the same rules.
 *
 * Who is acting is passed in by the caller after it has verified it: the
 * signed-in session for the app, or for the MCP connection the person who
 * created the connection link, re-checked as a current member on every call.
 * Nothing here takes a business or user id from the request itself.
 *
 * Every read and write repeats the business and visibility rules in the query,
 * whether the database client enforces them as well (the app's session client,
 * under row-level security) or not (the server client the MCP route uses).
 */

export type Actor = {
  userId: string;
  organizationId: string;
  role: string;
  timeZone: string;
  via: "app" | "chatgpt";
};

type Database = FlexibleSupabaseClient;
type Row = Record<string, unknown>;

const TASK_COLUMNS =
  "id, organization_id, created_by, owner_id, visibility, title, notes, status, assignee_type, assignee_user_id, assistant_connection_id, job_id, due_date, due_time, due_at, time_zone, reminder_at, execution_mode, scheduled_execution_at, recurrence, ai_instructions, completion_criteria, ai_permission_mode, completion_summary, artifacts, version, created_at, updated_at, completed_at, archived_at, jobs(id, job_number, customer_description, status, customers(first_name, last_name, company_name))";

export type TaskSummary = {
  id: string;
  title: string;
  notes: string | null;
  status: TaskStatus;
  status_label: string;
  visibility: TaskVisibility;
  due_date: string | null;
  due_time: string | null;
  due_label: string | null;
  time_zone: string;
  overdue: boolean;
  assignee: { type: "user" | "assistant" | "none"; user_id: string | null; name: string | null };
  job: { id: string; number: number; label: string; url: string } | null;
  execution_state: "none";
  needs_input: boolean;
  needs_approval: boolean;
  version: number;
  url: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  archived_at: string | null;
};

export type TaskActivity = {
  id: string;
  event: string;
  actor_type: "user" | "assistant" | "system";
  actor_name: string | null;
  via: string;
  detail: Row;
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

function appOrigin(): string {
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  return /^https?:\/\//.test(configured) ? configured : "https://volteira.com";
}

export function taskUrl(id: string): string {
  return `${appOrigin()}/tasks/${id}`;
}

function customerName(row: Row): string {
  return text(row.company_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
}

export function jobLabel(job: Row): string {
  const who = customerName(one(job.customers));
  const what = text(job.customer_description).replace(/\s+/g, " ").slice(0, 60);
  return [`#${text(job.job_number)}`, who, what].filter(Boolean).join(" · ");
}

/** The visibility rule as a PostgREST filter, for the service client that has no row-level security. */
function visibleTo(userId: string): string {
  return `visibility.eq.workspace,created_by.eq.${userId},owner_id.eq.${userId},assignee_user_id.eq.${userId}`;
}

function summarize(row: Row, actor: Actor, names: Map<string, string>, now: Date = new Date()): TaskSummary {
  const job = one(row.jobs);
  const status = (isTaskStatus(text(row.status)) ? text(row.status) : "todo") as TaskStatus;
  const dueDate = text(row.due_date) || null;
  const dueTime = text(row.due_time).slice(0, 5) || null;
  const zone = text(row.time_zone) || actor.timeZone;
  const assigneeType = (["user", "assistant", "none"].includes(text(row.assignee_type)) ? text(row.assignee_type) : "user") as
    | "user"
    | "assistant"
    | "none";
  const assigneeId = text(row.assignee_user_id) || null;
  const facts = { status, due_date: dueDate, due_at: text(row.due_at) || null, archived_at: text(row.archived_at) || null };
  return {
    id: text(row.id),
    title: text(row.title),
    notes: text(row.notes) || null,
    status,
    status_label: TASK_STATUS_LABELS[status],
    visibility: text(row.visibility) === "workspace" ? "workspace" : "private",
    due_date: dueDate,
    due_time: dueTime,
    due_label: dueDate ? dueLabel(dueDate, dueTime, zone, now) : null,
    time_zone: zone,
    overdue: isOverdue(facts, zone, now),
    assignee: {
      type: assigneeType,
      user_id: assigneeId,
      name: assigneeId ? (assigneeId === actor.userId ? "You" : (names.get(assigneeId) ?? "Team member")) : null,
    },
    job: text(job.id)
      ? { id: text(job.id), number: Number(job.job_number), label: jobLabel(job), url: `${appOrigin()}/jobs/${text(job.job_number)}` }
      : null,
    execution_state: "none",
    needs_input: status === "waiting_input",
    needs_approval: status === "waiting_approval",
    version: Number(row.version ?? 1),
    url: taskUrl(text(row.id)),
    created_at: text(row.created_at),
    updated_at: text(row.updated_at),
    completed_at: text(row.completed_at) || null,
    archived_at: text(row.archived_at) || null,
  };
}

async function memberNames(db: Database, organizationId: string, userIds: string[]): Promise<Map<string, string>> {
  const ids = [...new Set(userIds.filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length === 0) return names;
  const { data } = await db.from("user_profiles").select("user_id, display_name").in("user_id", ids);
  for (const row of rows(data)) names.set(text(row.user_id), text(row.display_name) || "Team member");
  void organizationId;
  return names;
}

/** The people a task can be assigned to: current members of this business. */
export async function listAssignableMembers(db: Database, actor: Actor): Promise<{ user_id: string; name: string; role: string }[]> {
  const { data } = await db
    .from("organization_members")
    .select("user_id, role")
    .eq("organization_id", actor.organizationId)
    .is("impersonation_session_id", null);
  const members = rows(data);
  const names = await memberNames(db, actor.organizationId, members.map((row) => text(row.user_id)));
  return members
    .map((row) => ({
      user_id: text(row.user_id),
      role: text(row.role),
      name: text(row.user_id) === actor.userId ? "You" : (names.get(text(row.user_id)) ?? "Team member"),
    }))
    .sort((a, b) => (a.user_id === actor.userId ? -1 : b.user_id === actor.userId ? 1 : a.name.localeCompare(b.name)));
}

async function isMember(db: Database, organizationId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("organization_members")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();
  return Boolean(data);
}

async function record(db: Database, actor: Actor, taskId: string, event: string, detail: Row = {}): Promise<void> {
  const { error } = await db.from("task_activity").insert({
    organization_id: actor.organizationId,
    task_id: taskId,
    actor_type: "user",
    actor_user_id: actor.userId,
    via: actor.via,
    event,
    detail,
  });
  if (error) console.error("task activity could not be recorded", { taskId, event, code: error.code });
}

async function loadRow(db: Database, actor: Actor, taskId: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(taskId)) return null;
  const { data } = await db
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("organization_id", actor.organizationId)
    .eq("id", taskId)
    .or(visibleTo(actor.userId))
    .maybeSingle();
  return data ? (data as Row) : null;
}

export type JobMatch = { id: string; number: number; label: string };

/**
 * A job of this business from what somebody said: its number ("1042", "#1042"),
 * its id, or words from the customer's name or the work. More than one match
 * is reported back, never picked between.
 */
export async function resolveJob(db: Database, actor: Actor, reference: string): Promise<Result<JobMatch>> {
  const ref = reference.trim();
  if (!ref) return fail("JOB_NOT_FOUND", "Say which job: its number, or the customer's name.", "job");
  const select = "id, job_number, customer_description, status, archived_at, customers(first_name, last_name, company_name)";

  const number = ref.replace(/^job\s*/i, "").replace(/^#/, "");
  if (/^\d+$/.test(number) || /^[0-9a-f-]{36}$/i.test(ref)) {
    const query = db.from("jobs").select(select).eq("organization_id", actor.organizationId);
    const { data } = await (/^\d+$/.test(number) ? query.eq("job_number", Number(number)) : query.eq("id", ref)).maybeSingle();
    const job = data as Row | null;
    if (!job) return fail("JOB_NOT_FOUND", `No job ${/^\d+$/.test(number) ? `#${number}` : ref} in this business.`, "job");
    return { ok: true, value: { id: text(job.id), number: Number(job.job_number), label: jobLabel(job) } };
  }

  const { data } = await db
    .from("jobs")
    .select(select)
    .eq("organization_id", actor.organizationId)
    .is("archived_at", null)
    .order("created_at", { ascending: false })
    .limit(300);
  const words = ref.toLowerCase().replace(/\bjob\b/g, "").split(/\s+/).filter((word) => word.length > 1);
  const matches = rows(data).filter((job) => {
    const haystack = `${customerName(one(job.customers))} ${text(job.customer_description)}`.toLowerCase();
    return words.length > 0 && words.every((word) => haystack.includes(word));
  });
  if (matches.length === 0) return fail("JOB_NOT_FOUND", `No job matches "${ref}". Try the job number.`, "job");
  if (matches.length > 1) {
    return fail(
      "JOB_AMBIGUOUS",
      `More than one job matches "${ref}": ${matches
        .slice(0, 6)
        .map((job) => jobLabel(job))
        .join("; ")}. Which one?`,
      "job",
    );
  }
  const job = matches[0]!;
  return { ok: true, value: { id: text(job.id), number: Number(job.job_number), label: jobLabel(job) } };
}

export type ListOptions = {
  view?: TaskView;
  filters?: TaskFilter[];
  job?: string;
  jobId?: string;
  status?: TaskStatus;
  q?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
  includeArchived?: boolean;
};

export type ListResult = { tasks: TaskSummary[]; total: number; next_offset: number | null; today: string; time_zone: string };

/** Tasks this person can see, by view, filter, job, status, words and dates, a page at a time. */
export async function listTasks(db: Database, actor: Actor, options: ListOptions = {}): Promise<Result<ListResult>> {
  const now = new Date();
  let query = db
    .from("tasks")
    .select(TASK_COLUMNS)
    .eq("organization_id", actor.organizationId)
    .or(visibleTo(actor.userId))
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  if (!options.includeArchived) query = query.is("archived_at", null);

  let jobId = options.jobId ?? "";
  if (!jobId && options.job) {
    const job = await resolveJob(db, actor, options.job);
    if (!job.ok) return job;
    jobId = job.value.id;
  }
  if (jobId) query = query.eq("job_id", jobId);
  if (options.status) query = query.eq("status", options.status);
  if (options.from) query = query.gte("due_date", options.from);
  if (options.to) query = query.lte("due_date", options.to);

  const { data, error } = await query;
  if (error) return fail("SAVE_FAILED", "Tasks could not be loaded. Try again.");

  const needle = (options.q ?? "").trim().toLowerCase();
  const view = options.view;
  const all = rows(data).filter((row) => {
    const facts = {
      status: text(row.status),
      due_date: text(row.due_date) || null,
      due_at: text(row.due_at) || null,
      archived_at: text(row.archived_at) || null,
      assignee_type: text(row.assignee_type),
      assignee_user_id: text(row.assignee_user_id) || null,
      created_by: text(row.created_by) || null,
      owner_id: text(row.owner_id) || null,
    };
    const zone = text(row.time_zone) || actor.timeZone;
    if (view && !(options.includeArchived && facts.archived_at) && !inView(facts, view, actor.userId, zone, now)) return false;
    for (const filter of options.filters ?? []) if (!matchesFilter(facts, filter, actor.userId, zone, now)) return false;
    if (needle && !`${text(row.title)} ${text(row.notes)}`.toLowerCase().includes(needle)) return false;
    return true;
  });

  if (view === "completed") all.sort((a, b) => text(b.completed_at || b.updated_at).localeCompare(text(a.completed_at || a.updated_at)));

  const limit = Math.min(Math.max(Math.floor(options.limit ?? 50), 1), 200);
  const offset = Math.max(Math.floor(options.offset ?? 0), 0);
  const page = all.slice(offset, offset + limit);
  const names = await memberNames(db, actor.organizationId, page.map((row) => text(row.assignee_user_id)));
  return {
    ok: true,
    value: {
      tasks: page.map((row) => summarize(row, actor, names, now)),
      total: all.length,
      next_offset: offset + limit < all.length ? offset + limit : null,
      today: todayIn(actor.timeZone, now),
      time_zone: actor.timeZone,
    },
  };
}

export async function getTask(
  db: Database,
  actor: Actor,
  taskId: string,
): Promise<Result<{ task: TaskSummary; activity: TaskActivity[]; raw: Row }>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  const { data } = await db
    .from("task_activity")
    .select("id, event, actor_type, actor_user_id, via, detail, created_at")
    .eq("organization_id", actor.organizationId)
    .eq("task_id", taskId)
    .order("created_at", { ascending: false })
    .limit(100);
  const history = rows(data);
  const names = await memberNames(db, actor.organizationId, [text(row.assignee_user_id), ...history.map((item) => text(item.actor_user_id))]);
  return {
    ok: true,
    value: {
      task: summarize(row, actor, names),
      raw: row,
      activity: history.map((item) => {
        const actorType = (["user", "assistant", "system"].includes(text(item.actor_type)) ? text(item.actor_type) : "system") as
          | "user"
          | "assistant"
          | "system";
        const who = text(item.actor_user_id);
        return {
          id: text(item.id),
          event: text(item.event),
          actor_type: actorType,
          actor_name: who ? (who === actor.userId ? "You" : (names.get(who) ?? "Team member")) : null,
          via: text(item.via),
          detail: typeof item.detail === "object" && item.detail !== null ? (item.detail as Row) : {},
          created_at: text(item.created_at),
        };
      }),
    },
  };
}

export type CreateInput = TaskInput & {
  job?: string;
  job_id?: string;
  assignee_user_id?: string;
  visibility?: TaskVisibility;
  idempotency_key?: string;
};

/**
 * Make one task. Only the title is needed. Without a job it is private and
 * assigned to whoever made it; on a job it is shared, because jobs are.
 */
export async function createTask(db: Database, actor: Actor, input: CreateInput): Promise<Result<{ task: TaskSummary; created: boolean }>> {
  const key = typeof input.idempotency_key === "string" ? input.idempotency_key.trim().slice(0, 200) : "";
  if (key) {
    const { data: existing } = await db
      .from("tasks")
      .select("id")
      .eq("organization_id", actor.organizationId)
      .eq("idempotency_key", key)
      .maybeSingle();
    if (existing) {
      const found = await getTask(db, actor, text((existing as Row).id));
      if (found.ok) return { ok: true, value: { task: found.value.task, created: false } };
      return fail("FORBIDDEN", "A task was already made for this request, and it is private to someone else.");
    }
  }

  const fields = readTaskFields(input, { creating: true, defaultTimeZone: actor.timeZone });
  if (!fields.ok) return fields;

  let jobId = "";
  if (input.job_id || input.job) {
    const job = await resolveJob(db, actor, input.job_id || input.job || "");
    if (!job.ok) return job;
    jobId = job.value.id;
  }

  const assignee = (input.assignee_user_id ?? "").trim() || actor.userId;
  if (assignee !== actor.userId && !(await isMember(db, actor.organizationId, assignee))) {
    return fail("INVALID_INPUT", "That person is not a member of this business.", "assignee_user_id");
  }

  const visibility: TaskVisibility = jobId ? "workspace" : input.visibility === "workspace" ? "workspace" : "private";
  const { data, error } = await db
    .from("tasks")
    .insert({
      organization_id: actor.organizationId,
      created_by: actor.userId,
      owner_id: actor.userId,
      visibility,
      assignee_type: "user",
      assignee_user_id: assignee,
      job_id: jobId || null,
      idempotency_key: key || null,
      ...fields.value,
    })
    .select("id")
    .maybeSingle();

  if (error?.code === "23505" && key) return createTask(db, actor, input);
  if (error || !data) return fail("SAVE_FAILED", "The task could not be saved. Try again.");
  const id = text((data as Row).id);
  await record(db, actor, id, "created", { title: fields.value.title, job_id: jobId || null, visibility, assignee_user_id: assignee });
  const created = await getTask(db, actor, id);
  if (!created.ok) return created;
  return { ok: true, value: { task: created.value.task, created: true } };
}

export type BulkItemResult =
  | { index: number; ok: true; created: boolean; task: TaskSummary }
  | { index: number; ok: false; error: { code: string; message: string } };

/**
 * Several tasks from one request. Each is made or refused on its own, and the
 * answer says which. With a request key, a retried request finds the tasks it
 * already made instead of making them twice.
 */
export async function createTasks(
  db: Database,
  actor: Actor,
  items: CreateInput[],
  shared: { job?: string; request_key?: string } = {},
): Promise<Result<{ results: BulkItemResult[] }>> {
  if (!Array.isArray(items) || items.length === 0) return fail("INVALID_INPUT", "Give at least one task.", "tasks");
  if (items.length > BULK_MAX) return fail("INVALID_INPUT", `At most ${BULK_MAX} tasks at once.`, "tasks");

  // One job lookup for the whole request, so an ambiguous name is asked about once.
  let sharedJobId = "";
  if (shared.job) {
    const job = await resolveJob(db, actor, shared.job);
    if (!job.ok) return job;
    sharedJobId = job.value.id;
  }

  const results: BulkItemResult[] = [];
  for (const [index, item] of items.entries()) {
    const key = shared.request_key ? `${shared.request_key.slice(0, 180)}:${index}` : item.idempotency_key;
    const made = await createTask(db, actor, {
      ...item,
      ...(sharedJobId && !item.job && !item.job_id ? { job_id: sharedJobId } : {}),
      idempotency_key: key,
    });
    results.push(made.ok ? { index, ok: true, created: made.value.created, task: made.value.task } : { index, ok: false, error: made.error });
  }
  return { ok: true, value: { results } };
}

export type UpdateInput = TaskInput & {
  status?: string;
  assignee_user_id?: string;
};

/**
 * Change a task. `version` is the one the caller read: a change made since
 * then is not overwritten, and the caller is told to look again.
 */
export async function updateTask(
  db: Database,
  actor: Actor,
  taskId: string,
  input: UpdateInput,
  version?: number,
): Promise<Result<TaskSummary>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  if (row.archived_at) return fail("ARCHIVED", "That task is archived. Restore it before changing it.");

  const current = {
    due_date: text(row.due_date) || null,
    due_time: text(row.due_time).slice(0, 5) || null,
    time_zone: text(row.time_zone) || actor.timeZone,
  };
  const fields = readTaskFields(input, { creating: false, defaultTimeZone: actor.timeZone, current });
  if (!fields.ok) return fields;

  const patch: Row = { ...fields.value };
  const changes: Row = {};
  for (const [key, value] of Object.entries(fields.value)) {
    if (key === "due_at") continue;
    const before = key === "due_time" ? current.due_time : (row[key] ?? null);
    if ((before ?? null) !== (value ?? null)) changes[key] = { from: key === "notes" ? undefined : before, to: key === "notes" ? "(edited)" : value };
  }

  if (input.status !== undefined) {
    const status = text(input.status);
    if (!isTaskStatus(status)) return fail("INVALID_INPUT", "That is not a task status.", "status");
    if (status !== text(row.status)) {
      patch.status = status;
      patch.completed_at = status === "complete" ? new Date().toISOString() : null;
      changes.status = { from: row.status, to: status };
    }
  }

  if (input.assignee_user_id !== undefined) {
    const assignee = text(input.assignee_user_id).trim();
    if (assignee && assignee !== actor.userId && !(await isMember(db, actor.organizationId, assignee))) {
      return fail("INVALID_INPUT", "That person is not a member of this business.", "assignee_user_id");
    }
    if ((assignee || null) !== (text(row.assignee_user_id) || null)) {
      patch.assignee_type = assignee ? "user" : "none";
      patch.assignee_user_id = assignee || null;
      patch.assistant_connection_id = null;
      changes.assignee_user_id = { from: row.assignee_user_id ?? null, to: assignee || null };
    }
  }

  if (Object.keys(changes).length === 0) {
    const same = await getTask(db, actor, taskId);
    return same.ok ? { ok: true, value: same.value.task } : same;
  }
  return writeChange(db, actor, row, patch, version, "updated", { changes });
}

async function writeChange(
  db: Database,
  actor: Actor,
  row: Row,
  patch: Row,
  version: number | undefined,
  event: string,
  detail: Row,
): Promise<Result<TaskSummary>> {
  const read = Number(row.version ?? 1);
  if (version !== undefined && version !== read) {
    return fail("VERSION_CONFLICT", "Someone changed this task since you opened it. Look at it again, then make your change.");
  }
  const id = text(row.id);
  const { data, error } = await db
    .from("tasks")
    .update({ ...patch, version: read + 1 })
    .eq("organization_id", actor.organizationId)
    .eq("id", id)
    .eq("version", read)
    .select("id")
    .maybeSingle();
  if (error) return fail("SAVE_FAILED", "The change could not be saved. Try again.");
  if (!data) return fail("VERSION_CONFLICT", "Someone changed this task at the same moment. Look at it again, then make your change.");
  await record(db, actor, id, event, detail);
  const after = await getTask(db, actor, id);
  return after.ok ? { ok: true, value: after.value.task } : after;
}

export async function completeTask(db: Database, actor: Actor, taskId: string, version?: number, summary?: string): Promise<Result<TaskSummary>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  if (row.archived_at) return fail("ARCHIVED", "That task is archived.");
  const next = completeTransition(text(row.status));
  if (!next.ok) return next;
  const note = typeof summary === "string" ? summary.trim().slice(0, 2000) : "";
  return writeChange(
    db,
    actor,
    row,
    { status: next.value, completed_at: new Date().toISOString(), ...(note ? { completion_summary: note } : {}) },
    version,
    "completed",
    { from: row.status },
  );
}

export async function reopenTask(db: Database, actor: Actor, taskId: string, version?: number): Promise<Result<TaskSummary>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  if (row.archived_at) return fail("ARCHIVED", "That task is archived. Restore it first.");
  const next = reopenTransition(text(row.status));
  if (!next.ok) return next;
  return writeChange(db, actor, row, { status: next.value, completed_at: null }, version, "reopened", { from: row.status });
}

/** Archive keeps the task and its history; restore brings it back as it was. */
export async function archiveTask(db: Database, actor: Actor, taskId: string, version?: number, restore = false): Promise<Result<TaskSummary>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  if (!restore && row.archived_at) return fail("ARCHIVED", "That task is already archived.");
  if (restore && !row.archived_at) return fail("INVALID_INPUT", "That task is not archived.");
  return writeChange(db, actor, row, { archived_at: restore ? null : new Date().toISOString() }, version, restore ? "restored" : "archived", {});
}

/**
 * Put a task on a job, or move it to another. A private task is only made
 * visible to the business once that has been confirmed. The task keeps its
 * history across the move; the job itself is not changed.
 */
export async function linkTaskToJob(
  db: Database,
  actor: Actor,
  taskId: string,
  jobReference: string,
  options: { confirmVisibility?: boolean; version?: number } = {},
): Promise<Result<TaskSummary>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  if (row.archived_at) return fail("ARCHIVED", "That task is archived.");
  const job = await resolveJob(db, actor, jobReference);
  if (!job.ok) return job;
  if (text(row.job_id) === job.value.id) {
    const same = await getTask(db, actor, taskId);
    return same.ok ? { ok: true, value: same.value.task } : same;
  }
  const visibility = visibilityForJobLink(text(row.visibility) === "workspace" ? "workspace" : "private", options.confirmVisibility === true);
  if (!visibility.ok) return visibility;
  const previous = text(row.job_id) || null;
  return writeChange(
    db,
    actor,
    row,
    { job_id: job.value.id, visibility: "workspace" },
    options.version,
    previous ? "moved" : "linked",
    { from_job_id: previous, to_job_id: job.value.id, to_job: job.value.label, made_shared: visibility.value.changed },
  );
}

/** Take a task off its job without deleting it. It stays visible to the business it was shared with. */
export async function unlinkTaskFromJob(db: Database, actor: Actor, taskId: string, version?: number): Promise<Result<TaskSummary>> {
  const row = await loadRow(db, actor, taskId);
  if (!row) return fail("NOT_FOUND", "That task was not found, or it is private to someone else.");
  if (!row.job_id) return fail("INVALID_INPUT", "That task is not on a job.");
  return writeChange(db, actor, row, { job_id: null }, version, "unlinked", { from_job_id: row.job_id });
}

/** A job's tasks and how many are done, for its Tasks section and its count. */
export async function jobTaskCounts(db: Database, actor: Actor, jobId: string): Promise<{ done: number; total: number }> {
  const { data } = await db
    .from("tasks")
    .select("status")
    .eq("organization_id", actor.organizationId)
    .eq("job_id", jobId)
    .is("archived_at", null)
    .or(visibleTo(actor.userId));
  const list = rows(data);
  return { done: list.filter((row) => isClosed(text(row.status))).length, total: list.length };
}

/** "Friday, 2026-11-14" — how a resolved date is said back to whoever gave it. */
export function sayDate(date: string | null): string {
  return date ? `${weekdayOf(date)}, ${date}` : "";
}

/**
 * "Has anything changed?" for a screen showing tasks: the newest change among
 * the tasks this person can see (on one job, if given) and how many there are.
 * A screen re-renders only when this differs from what it was drawn with, so a
 * task made or changed from ChatGPT appears without anyone reloading.
 */
export async function tasksFingerprint(db: Database, actor: Actor, jobId?: string): Promise<string> {
  let query = db
    .from("tasks")
    .select("id, updated_at")
    .eq("organization_id", actor.organizationId)
    .or(visibleTo(actor.userId))
    .order("updated_at", { ascending: false })
    .limit(1);
  if (jobId) query = query.eq("job_id", jobId);
  const { data } = await query;
  let countQuery = db.from("tasks").select("id", { count: "exact", head: true }).eq("organization_id", actor.organizationId).or(visibleTo(actor.userId));
  if (jobId) countQuery = countQuery.eq("job_id", jobId);
  const { count } = await countQuery;
  const latest = rows(data)[0];
  return `${count ?? 0}:${text(latest?.updated_at)}:${text(latest?.id)}`;
}
