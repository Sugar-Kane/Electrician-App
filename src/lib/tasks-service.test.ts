import assert from "node:assert/strict";
import { test } from "node:test";

import {
  completeTask,
  createTask,
  createTasks,
  getTask,
  linkTaskToJob,
  listTasks,
  reopenTask,
  updateTask,
  type Actor,
} from "./tasks-service.ts";

/*
 * An in-memory stand-in for the database with no row-level security, like the
 * server client the MCP route uses. Every privacy rule these tests check is
 * therefore the service's own, not the database's.
 */
type Row = Record<string, unknown>;

function fakeDatabase(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    tasks: [],
    task_activity: [],
    user_profiles: [],
    organization_members: [
      { organization_id: "org-a", user_id: "ann", role: "owner", impersonation_session_id: null },
      { organization_id: "org-a", user_id: "bob", role: "technician", impersonation_session_id: null },
      { organization_id: "org-b", user_id: "eve", role: "owner", impersonation_session_id: null },
    ],
    jobs: [
      { id: "11111111-1111-1111-1111-111111111111", organization_id: "org-a", job_number: 1042, customer_description: "Panel replacement", archived_at: null, created_at: "2026-11-01", customers: { first_name: "Jo", last_name: "Smith" } },
      { id: "22222222-2222-2222-2222-222222222222", organization_id: "org-a", job_number: 1043, customer_description: "Outlet repair", archived_at: null, created_at: "2026-11-02", customers: { first_name: "Al", last_name: "Smith" } },
      { id: "33333333-3333-3333-3333-333333333333", organization_id: "org-b", job_number: 7, customer_description: "Other business", archived_at: null, created_at: "2026-11-03", customers: { first_name: "Zed", last_name: "Other" } },
    ],
    ...seed,
  };
  let counter = 0;

  function query(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" = "select";
    let payload: Row = {};
    let limit = Infinity;
    const builder: Record<string, unknown> = {};
    const chain = () => builder;
    Object.assign(builder, {
      select: chain,
      order: chain,
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
      insert: (value: Row) => ((mode = "insert"), (payload = value), builder),
      update: (value: Row) => ((mode = "update"), (payload = value), builder),
      maybeSingle: () => run().then((result) => ({ ...result, data: Array.isArray(result.data) ? (result.data[0] ?? null) : result.data })),
      then: (resolve: (value: unknown) => unknown) => run().then(resolve),
    });

    async function run(): Promise<{ data: unknown; error: unknown }> {
      const list = tables[table] ?? (tables[table] = []);
      if (mode === "insert") {
        if (table === "tasks" && payload.idempotency_key && list.some((row) => row.organization_id === payload.organization_id && row.idempotency_key === payload.idempotency_key)) {
          return { data: null, error: { code: "23505" } };
        }
        const row = { id: `0000000${++counter}`.slice(-8) + "-0000-0000-0000-000000000000", version: 1, archived_at: null, completed_at: null, status: "todo", created_at: new Date().toISOString(), ...payload };
        list.push(row);
        return { data: [row], error: null };
      }
      const matched = list.filter((row) => filters.every((filter) => filter(row)));
      if (mode === "update") {
        for (const row of matched) Object.assign(row, payload);
        return { data: matched, error: null };
      }
      const withJobs = matched.map((row) => (table === "tasks" ? { ...row, jobs: tables.jobs!.find((job) => job.id === row.job_id) ?? null } : row));
      return { data: withJobs.slice(0, limit), error: null };
    }
    return builder;
  }

  return { database: { from: query } as never, tables };
}

const ann: Actor = { userId: "ann", organizationId: "org-a", role: "owner", timeZone: "America/Los_Angeles", via: "chatgpt" };
const bob: Actor = { ...ann, userId: "bob", role: "technician", via: "app" };
const eve: Actor = { userId: "eve", organizationId: "org-b", role: "owner", timeZone: "America/Los_Angeles", via: "app" };

test("a task with only a title is private to its creator and assigned to them", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "Order materials" });
  assert.ok(made.ok);
  assert.equal(made.value.task.visibility, "private");
  assert.equal(made.value.task.assignee.user_id, "ann");

  assert.equal((await getTask(database, bob, made.value.task.id)).ok, false, "a colleague cannot open a private task");
  assert.equal((await getTask(database, eve, made.value.task.id)).ok, false, "another business cannot either");
  const bobList = await listTasks(database, bob, { view: "all" });
  assert.ok(bobList.ok && bobList.value.tasks.length === 0);
});

test("a task made on a job is shared with the business, and never with another business", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "Confirm appointment", job: "1042" });
  assert.ok(made.ok);
  assert.equal(made.value.task.visibility, "workspace");
  assert.equal(made.value.task.job?.number, 1042);
  assert.ok((await getTask(database, bob, made.value.task.id)).ok);
  assert.equal((await getTask(database, eve, made.value.task.id)).ok, false);

  const theirs = await createTask(database, eve, { title: "x", job: "1042" });
  assert.equal(!theirs.ok && theirs.error.code, "JOB_NOT_FOUND", "a job number is looked up only in the actor's own business");
});

test("an ambiguous job is asked about, not guessed", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "Call them", job: "Smith" });
  assert.equal(!made.ok && made.error.code, "JOB_AMBIGUOUS");
  const exact = await createTask(database, ann, { title: "Order the panel", job: "Smith panel" });
  assert.ok(exact.ok && exact.value.task.job?.number === 1042);
});

test("linking a private task to a job needs the visibility change confirmed", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "Private note", notes: "gate code 1234" });
  assert.ok(made.ok);
  const refused = await linkTaskToJob(database, ann, made.value.task.id, "1042");
  assert.equal(!refused.ok && refused.error.code, "VISIBILITY_CHANGE_NEEDS_CONFIRMATION");
  assert.equal((await getTask(database, bob, made.value.task.id)).ok, false, "still private after the refusal");
  const linked = await linkTaskToJob(database, ann, made.value.task.id, "1042", { confirmVisibility: true });
  assert.ok(linked.ok && linked.value.visibility === "workspace");
  const moved = await linkTaskToJob(database, ann, made.value.task.id, "1043");
  assert.ok(moved.ok && moved.value.job?.number === 1043, "moving a shared task needs no second confirmation");
});

test("a retried request does not make the same tasks twice, and each item reports its own outcome", async () => {
  const { database, tables } = fakeDatabase();
  const items = [{ title: "Order the panel", due_date: "2026-11-08" }, { title: "" }, { title: "Prepare permit paperwork" }];
  const first = await createTasks(database, ann, items, { job: "1042", request_key: "req-1" });
  assert.ok(first.ok);
  assert.deepEqual(first.value.results.map((result) => result.ok), [true, false, true]);
  const again = await createTasks(database, ann, items, { job: "1042", request_key: "req-1" });
  assert.ok(again.ok);
  assert.deepEqual(again.value.results.map((result) => result.ok && result.created), [false, false, false]);
  assert.equal(tables.tasks!.length, 2, "no duplicates");
});

test("an edit made from a stale copy is refused rather than overwriting a newer change", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "Draft", job: "1042" });
  assert.ok(made.ok);
  const fromApp = await updateTask(database, bob, made.value.task.id, { title: "Draft the follow-up" }, made.value.task.version);
  assert.ok(fromApp.ok);
  const stale = await updateTask(database, ann, made.value.task.id, { title: "Old idea" }, made.value.task.version);
  assert.equal(!stale.ok && stale.error.code, "VERSION_CONFLICT");
  const current = await getTask(database, ann, made.value.task.id);
  assert.ok(current.ok && current.value.task.title === "Draft the follow-up", "the change made in the app is what ChatGPT reads back");
});

test("assigning to someone outside the business is refused", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "x", assignee_user_id: "eve" });
  assert.equal(made.ok, false);
});

test("completing and reopening keep the history", async () => {
  const { database } = fakeDatabase();
  const made = await createTask(database, ann, { title: "Order materials" });
  assert.ok(made.ok);
  const done = await completeTask(database, ann, made.value.task.id);
  assert.ok(done.ok && done.value.status === "complete" && done.value.completed_at);
  const reopened = await reopenTask(database, ann, made.value.task.id);
  assert.ok(reopened.ok && reopened.value.status === "todo" && !reopened.value.completed_at);
  const detail = await getTask(database, ann, made.value.task.id);
  assert.ok(detail.ok);
  assert.deepEqual(detail.value.activity.map((item) => item.event).sort(), ["completed", "created", "reopened"]);
});

test("ChatGPT creates job tasks in one request and reads back what the app sees", async () => {
  const { runTaskTool } = await import("./mcp-task-tools.ts");
  const { database } = fakeDatabase();
  const made = await runTaskTool({
    database,
    actor: ann,
    name: "create_tasks",
    args: {
      job: "Smith panel",
      request_id: "voice-1",
      tasks: [{ title: "Order the panel", due_date: "2026-11-08" }, { title: "Confirm the appointment", due_date: "2026-11-13" }, { title: "Prepare permit paperwork" }],
    },
  });
  assert.equal(made.isError, false);
  const results = (made.structured?.results ?? []) as { ok: boolean; task: { id: string; job: { number: number } } }[];
  assert.equal(results.length, 3);
  assert.ok(results.every((result) => result.ok && result.task.job.number === 1042));

  const inApp = await listTasks(database, bob, { jobId: "11111111-1111-1111-1111-111111111111", view: "all" });
  assert.ok(inApp.ok && inApp.value.tasks.length === 3, "the job's Tasks section shows the same three records");

  await updateTask(database, bob, results[0]!.task.id, { title: "Order the 200A panel" });
  const read = await runTaskTool({ database, actor: ann, name: "get_task", args: { task_id: results[0]!.task.id } });
  assert.match(read.text, /Order the 200A panel/, "an edit in the app is what ChatGPT reads next");
});

test("without a verified person behind the connection, task tools refuse", async () => {
  const { runTaskTool } = await import("./mcp-task-tools.ts");
  const { database, tables } = fakeDatabase();
  const refused = await runTaskTool({ database, actor: null, name: "create_task", args: { title: "x" } });
  assert.equal(refused.isError, true);
  assert.equal((refused.structured?.error as { code: string }).code, "NOT_CONNECTED");
  assert.equal(tables.tasks!.length, 0);
});
