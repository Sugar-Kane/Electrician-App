import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";
import { datesToMake, nextOccurrence, type RepeatRule } from "./task-recurrence.ts";
import { isClosed, todayIn } from "./task-rules.ts";
import { occurrenceFields } from "./tasks-service.ts";
import { reconcileStuckActions, runExecution, settleCancelRequests, type AssistantDeps } from "./task-executions.ts";

/**
 * The background worker for tasks. Runs on the server, called by the
 * database's scheduler (pg_cron, every minute, only when something is due),
 * never by a browser or a ChatGPT conversation.
 *
 * Reminders come from task_work rows, claimed with a lease so a run that dies
 * leaves them to be claimed again, and re-checked against the task before
 * anything is sent: a reminder moved, or a task completed or archived since it
 * was queued, is called off instead of sent. Each reminder notifies once,
 * keyed on the queue row, however many times it is retried.
 *
 * Recurring tasks: each active series whose next date is within a week gets
 * its occurrences made, one task per date, guarded by a unique index so two
 * overlapping runs cannot make the same date twice.
 */

type Database = FlexibleSupabaseClient;
type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function rows(data: unknown): Row[] {
  return Array.isArray(data) ? (data as Row[]) : [];
}

/** 1, 2, 4, 8 … minutes, at most 30, before trying a failed item again. */
export function backoffMinutes(attempt: number): number {
  return Math.min(30, 2 ** Math.max(0, attempt - 1));
}

export type WorkerReport = {
  reminders_sent: number;
  reminders_called_off: number;
  executions_run: number;
  actions_reconciled: number;
  retried: number;
  failed: number;
  occurrences_made: number;
};

async function finish(db: Database, id: string, status: "done" | "canceled" | "failed", error?: string) {
  await db
    .from("task_work")
    .update({ status, finished_at: new Date().toISOString(), lease_until: null, ...(error ? { last_error: error.slice(0, 500) } : {}) })
    .eq("id", id);
}

/** One claimed reminder: check it still stands, notify once, record it. */
export async function processReminder(db: Database, work: Row, now: Date = new Date()): Promise<"sent" | "called_off"> {
  const { data } = await db
    .from("tasks")
    .select("id, organization_id, title, status, archived_at, reminder_at, assignee_user_id, owner_id, created_by, due_date, due_time")
    .eq("id", text(work.task_id))
    .maybeSingle();
  const task = data as Row | null;
  const stillWanted =
    task &&
    !task.archived_at &&
    !isClosed(text(task.status)) &&
    text(task.reminder_at) &&
    Date.parse(text(task.reminder_at)) === Date.parse(text(work.run_at));
  if (!stillWanted) {
    await finish(db, text(work.id), "canceled", "The reminder was moved, or the task was finished or archived.");
    return "called_off";
  }
  const recipient = text(task.assignee_user_id) || text(task.owner_id) || text(task.created_by);
  if (recipient) {
    const due = text(task.due_date) ? ` Due ${text(task.due_date)}${text(task.due_time) ? ` at ${text(task.due_time).slice(0, 5)}` : ""}.` : "";
    const { error } = await db.from("task_notifications").upsert(
      {
        organization_id: task.organization_id,
        user_id: recipient,
        task_id: task.id,
        kind: "reminder",
        title: `Reminder: ${text(task.title)}`.slice(0, 300),
        body: due.trim() || null,
        dedupe_key: `reminder:${text(work.id)}`,
      },
      { onConflict: "dedupe_key", ignoreDuplicates: true },
    );
    if (error) throw new Error(`notification not saved (${error.code ?? "unknown"})`);
  }
  await db.from("tasks").update({ reminder_sent_at: now.toISOString() }).eq("id", text(task.id));
  await db.from("task_activity").insert({
    organization_id: task.organization_id,
    task_id: task.id,
    actor_type: "system",
    via: "system",
    event: "reminder_sent",
    detail: { to: recipient || null },
  });
  await finish(db, text(work.id), "done");
  return "sent";
}

/** A failed attempt goes back in the queue with a delay, or stops for good after its last attempt. */
async function retryOrFail(db: Database, work: Row, error: unknown, now: Date): Promise<"retried" | "failed"> {
  const message = error instanceof Error ? error.message : "Unknown error";
  const attempts = Number(work.attempts ?? 1);
  if (attempts >= Number(work.max_attempts ?? 5)) {
    await finish(db, text(work.id), "failed", message);
    return "failed";
  }
  await db
    .from("task_work")
    .update({
      status: "pending",
      lease_until: null,
      last_error: message.slice(0, 500),
      run_at: new Date(now.getTime() + backoffMinutes(attempts) * 60_000).toISOString(),
    })
    .eq("id", text(work.id));
  return "retried";
}

/** Make the occurrences that are due for every active series. */
export async function makeOccurrences(db: Database, now: Date = new Date()): Promise<number> {
  const horizon = new Date(now.getTime() + 8 * 86_400_000).toISOString().slice(0, 10);
  const { data } = await db.from("task_series").select("*").eq("active", true).lte("next_date", horizon).limit(200);
  let made = 0;
  for (const series of rows(data)) {
    const rule = series.rule as RepeatRule;
    const zone = text(series.time_zone) || "America/Los_Angeles";
    const dates = datesToMake(rule, text(series.start_date), text(series.last_made) || null, Number(series.made_count ?? 0), todayIn(zone, now));
    let lastMade = text(series.last_made) || null;
    let count = Number(series.made_count ?? 0);
    for (const date of dates) {
      const { data: created, error } = await db.from("tasks").insert(occurrenceFields(series, date, now)).select("id").maybeSingle();
      if (!error && created) {
        made += 1;
        await db.from("task_activity").insert({
          organization_id: series.organization_id,
          task_id: (created as Row).id,
          actor_type: "system",
          via: "system",
          event: "created",
          detail: { from_series: series.id, occurrence_date: date },
        });
      } else if (error && error.code !== "23505") {
        // Anything but "already made" stops this series for this run; it is tried again next run.
        break;
      }
      lastMade = date;
      count += 1;
    }
    // The series moves on past the dates just made (or found already made);
    // dates skipped because they were already in the past count as passed.
    const after = lastMade ?? text(series.start_date);
    let next = nextOccurrence(rule, text(series.start_date), after, count);
    const today = todayIn(zone, now);
    while (next && next < today) {
      count += 1;
      next = nextOccurrence(rule, text(series.start_date), next, count);
    }
    await db
      .from("task_series")
      .update({
        last_made: lastMade,
        made_count: count,
        next_date: next,
        ...(next ? {} : { active: false, ended_at: now.toISOString() }),
      })
      .eq("id", text(series.id))
      .eq("version", Number(series.version ?? 1));
  }
  return made;
}

/** One run: claim due work in batches until it is gone or time is short, then make occurrences. */
export async function runTaskWorker(
  db: Database,
  options: { budgetMs?: number; now?: () => Date; assistant?: AssistantDeps } = {},
): Promise<WorkerReport> {
  const started = Date.now();
  const budget = options.budgetMs ?? 40_000;
  const clock = options.now ?? (() => new Date());
  const report: WorkerReport = { reminders_sent: 0, reminders_called_off: 0, executions_run: 0, actions_reconciled: 0, retried: 0, failed: 0, occurrences_made: 0 };
  const assistant = options.assistant;

  // Actions whose outcome was never written down are settled first, from the
  // record they left; they are never carried out a second time.
  if (assistant) {
    const settled = await reconcileStuckActions(db, assistant);
    report.actions_reconciled = settled.executed + settled.failed + settled.uncertain;
    await settleCancelRequests(db, assistant);
  }

  for (let batch = 0; batch < 20 && Date.now() - started < budget; batch += 1) {
    const { data, error } = await db.rpc("claim_task_work", { p_limit: 25, p_lease_seconds: 120 });
    if (error) throw new Error(`could not claim work (${error.code ?? "unknown"})`);
    const claimed = rows(data);
    if (claimed.length === 0) break;
    for (const work of claimed) {
      try {
        if (text(work.kind) === "reminder") {
          const outcome = await processReminder(db, work, clock());
          if (outcome === "sent") report.reminders_sent += 1;
          else report.reminders_called_off += 1;
        } else if (!assistant) {
          await finish(db, text(work.id), "failed", "Assistant work is not available on this server.");
          report.failed += 1;
        } else if (Date.now() - started > budget) {
          // Out of time for a model call: hand the row back untouched for the next run.
          await db
            .from("task_work")
            .update({ status: "pending", lease_until: null, attempts: Math.max(0, Number(work.attempts ?? 1) - 1) })
            .eq("id", text(work.id));
        } else {
          const step = await runExecution(db, assistant, work);
          if (step === "retry") {
            const attempts = Number(work.attempts ?? 1);
            await db
              .from("task_work")
              .update({ status: "pending", lease_until: null, run_at: new Date(clock().getTime() + backoffMinutes(attempts) * 60_000).toISOString() })
              .eq("id", text(work.id));
            report.retried += 1;
          } else {
            await finish(db, text(work.id), step === "canceled" ? "canceled" : step === "failed" ? "failed" : "done");
            if (step === "ran") report.executions_run += 1;
            if (step === "failed") report.failed += 1;
          }
        }
      } catch (error) {
        // A run that broke part-way leaves its execution able to be picked up again.
        if (text(work.kind) === "execution" && text(work.execution_id)) {
          await db.from("task_executions").update({ status: "queued" }).eq("id", text(work.execution_id)).eq("status", "running");
        }
        const outcome = await retryOrFail(db, work, error, clock());
        if (outcome === "failed" && text(work.kind) === "execution" && text(work.execution_id)) {
          await db
            .from("task_executions")
            .update({ status: "failed", error: "The work kept failing and was stopped.", finished_at: clock().toISOString() })
            .eq("id", text(work.execution_id))
            .eq("status", "queued");
        }
        report[outcome === "retried" ? "retried" : "failed"] += 1;
      }
    }
  }

  if (Date.now() - started < budget) report.occurrences_made = await makeOccurrences(db, clock());
  return report;
}
