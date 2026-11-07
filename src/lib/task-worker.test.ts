import assert from "node:assert/strict";
import { test } from "node:test";

import { backoffMinutes, makeOccurrences, processReminder, runTaskWorker } from "./task-worker.ts";

/* A small in-memory database: enough of PostgREST and the claim function for the worker. */
type Row = Record<string, unknown>;

function fakeDatabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = { tasks: [], task_work: [], task_notifications: [], task_activity: [], task_series: [], ...seed };
  let ids = 0;
  let failNotifications = 0;
  function from(table: string) {
    const filters: ((row: Row) => boolean)[] = [];
    let mode: "select" | "insert" | "update" | "upsert" = "select";
    let payload: Row = {};
    let options: Row = {};
    const builder: Record<string, unknown> = {};
    Object.assign(builder, {
      select: () => builder,
      order: () => builder,
      limit: () => builder,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), builder),
      lte: (c: string, v: string) => (filters.push((r) => r[c] != null && String(r[c]) <= v), builder),
      insert: (v: Row) => ((mode = "insert"), (payload = v), builder),
      update: (v: Row) => ((mode = "update"), (payload = v), builder),
      upsert: (v: Row, o: Row) => ((mode = "upsert"), (payload = v), (options = o), builder),
      maybeSingle: () => run().then((r) => ({ ...r, data: Array.isArray(r.data) ? (r.data[0] ?? null) : r.data })),
      then: (resolve: (v: unknown) => unknown) => run().then(resolve),
    });
    async function run(): Promise<{ data: unknown; error: unknown }> {
      const list = (tables[table] ??= []);
      if (mode === "insert" || mode === "upsert") {
        if (table === "task_notifications" && failNotifications > 0) {
          failNotifications -= 1;
          return { data: null, error: { code: "57014" } };
        }
        if (table === "task_notifications" && list.some((r) => r.dedupe_key === payload.dedupe_key)) {
          return options.ignoreDuplicates ? { data: [], error: null } : { data: null, error: { code: "23505" } };
        }
        if (table === "tasks" && payload.series_id && list.some((r) => r.series_id === payload.series_id && r.occurrence_date === payload.occurrence_date)) {
          return { data: null, error: { code: "23505" } };
        }
        const row = { id: `id-${++ids}`, ...payload };
        list.push(row);
        return { data: [row], error: null };
      }
      const matched = list.filter((r) => filters.every((f) => f(r)));
      if (mode === "update") matched.forEach((r) => Object.assign(r, payload));
      return { data: matched, error: null };
    }
    return builder;
  }
  const database = {
    from,
    rpc: async (name: string) => {
      assert.equal(name, "claim_task_work");
      const now = Date.now();
      const due = tables.task_work!.filter(
        (w) => (w.status === "pending" && Date.parse(String(w.run_at)) <= now) || (w.status === "claimed" && Date.parse(String(w.lease_until)) < now),
      );
      for (const w of due) Object.assign(w, { status: "claimed", attempts: Number(w.attempts ?? 0) + 1, lease_until: new Date(now + 120_000).toISOString() });
      return { data: due.map((w) => ({ ...w })), error: null };
    },
  };
  return { database: database as never, tables, failNextNotifications: (n: number) => (failNotifications = n) };
}

const past = new Date(Date.now() - 60_000).toISOString();

function task(overrides: Row = {}): Row {
  return { id: "t1", organization_id: "org", title: "Order materials", status: "todo", archived_at: null, reminder_at: past, assignee_user_id: "ann", owner_id: "ann", created_by: "ann", due_date: null, due_time: null, ...overrides };
}

test("a due reminder notifies its assignee once, even if the run is repeated", async () => {
  const { database, tables } = fakeDatabase({ tasks: [task()], task_work: [{ id: "w1", task_id: "t1", kind: "reminder", run_at: past, status: "pending", attempts: 0, max_attempts: 5 }] });
  const report = await runTaskWorker(database);
  assert.equal(report.reminders_sent, 1);
  assert.equal(tables.task_notifications!.length, 1);
  assert.equal(tables.task_notifications![0]!.user_id, "ann");
  assert.equal(tables.task_work![0]!.status, "done");
  // The same queue row processed again (say, a lease that ran out after sending): no second notification.
  await processReminder(database, { ...tables.task_work![0]!, status: "claimed" });
  assert.equal(tables.task_notifications!.length, 1);
});

test("a reminder moved, or a task finished, since it was queued is called off, not sent", async () => {
  const later = new Date(Date.now() + 3_600_000).toISOString();
  const { database, tables } = fakeDatabase({
    tasks: [task({ id: "moved", reminder_at: later }), task({ id: "done", status: "complete" })],
    task_work: [
      { id: "w1", task_id: "moved", kind: "reminder", run_at: past, status: "pending", attempts: 0, max_attempts: 5 },
      { id: "w2", task_id: "done", kind: "reminder", run_at: past, status: "pending", attempts: 0, max_attempts: 5 },
    ],
  });
  const report = await runTaskWorker(database);
  assert.equal(report.reminders_sent, 0);
  assert.equal(report.reminders_called_off, 2);
  assert.equal(tables.task_notifications!.length, 0);
  assert.ok(tables.task_work!.every((w) => w.status === "canceled"));
});

test("a failed attempt is retried later with backoff, and stops for good after its last attempt", async () => {
  const { database, tables, failNextNotifications } = fakeDatabase({
    tasks: [task()],
    task_work: [{ id: "w1", task_id: "t1", kind: "reminder", run_at: past, status: "pending", attempts: 0, max_attempts: 2 }],
  });
  failNextNotifications(5);
  const first = await runTaskWorker(database);
  assert.equal(first.retried, 1);
  assert.equal(tables.task_work![0]!.status, "pending");
  assert.ok(Date.parse(String(tables.task_work![0]!.run_at)) > Date.now(), "pushed into the future");
  tables.task_work![0]!.run_at = past;
  const second = await runTaskWorker(database);
  assert.equal(second.failed, 1);
  assert.equal(tables.task_work![0]!.status, "failed");
  assert.match(String(tables.task_work![0]!.last_error), /notification not saved/);
  assert.deepEqual([1, 2, 3, 4, 9].map(backoffMinutes), [1, 2, 4, 8, 30]);
});

test("a run that died mid-claim leaves the work to be claimed again", async () => {
  const { database, tables } = fakeDatabase({
    tasks: [task()],
    task_work: [{ id: "w1", task_id: "t1", kind: "reminder", run_at: past, status: "claimed", attempts: 1, max_attempts: 5, lease_until: past }],
  });
  const report = await runTaskWorker(database);
  assert.equal(report.reminders_sent, 1);
  assert.equal(tables.task_work![0]!.attempts, 2);
});

test("recurring occurrences are made a week ahead and never twice", async () => {
  const today = new Date().toISOString().slice(0, 10);
  const series = {
    id: "s1", organization_id: "org", created_by: "ann", owner_id: "ann", visibility: "private", title: "Check the van stock", notes: null, job_id: null,
    assignee_user_id: "ann", due_time: "08:00", time_zone: "UTC", reminder_time: null, reminder_days_before: null,
    rule: { freq: "daily", interval: 1, weekdays: [], monthday: null, until: null, count: null },
    start_date: today, last_made: today, made_count: 1, next_date: today, active: true, version: 1,
  };
  const { database, tables } = fakeDatabase({ task_series: [series], tasks: [{ id: "first", series_id: "s1", occurrence_date: today }] });
  const made = await makeOccurrences(database);
  assert.equal(made, 7, "the next seven days");
  const dates = tables.tasks!.filter((t) => t.series_id === "s1").map((t) => t.occurrence_date);
  assert.equal(new Set(dates).size, dates.length, "one task per date");
  tables.task_series![0]!.last_made = today;
  tables.task_series![0]!.made_count = 1;
  const again = await makeOccurrences(database);
  assert.equal(again, 0, "a repeated run finds them already made");
});
