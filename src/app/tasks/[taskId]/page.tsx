import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Briefcase, Lock, Users } from "lucide-react";

import { archiveTaskAction, toggleTaskComplete } from "@/app/tasks/actions";
import { FieldPageShell } from "@/components/field-page-shell";
import { RefreshOnChange } from "@/components/refresh-on-change";
import { TaskEditForm } from "@/components/tasks/task-edit-form";
import { TaskJobForm } from "@/components/tasks/task-job-form";
import { appTaskActor } from "@/lib/task-actor";
import { getTask, listAssignableMembers, tasksFingerprint, type TaskActivity } from "@/lib/tasks-service";

export const dynamic = "force-dynamic";

const EVENT_LABELS: Record<string, string> = {
  created: "Created",
  updated: "Edited",
  completed: "Completed",
  reopened: "Reopened",
  archived: "Archived",
  restored: "Restored",
  linked: "Linked to a job",
  moved: "Moved to another job",
  unlinked: "Taken off its job",
};

function describe(item: TaskActivity): string {
  const label = EVENT_LABELS[item.event] ?? item.event;
  const changes = item.detail.changes && typeof item.detail.changes === "object" ? Object.keys(item.detail.changes as object) : [];
  const what = changes.length ? `: ${changes.map((key) => key.replace(/_/g, " ").replace("user id", "")).join(", ")}` : "";
  const job = typeof item.detail.to_job === "string" ? ` (${item.detail.to_job})` : "";
  const shared = item.detail.made_shared === true ? " and shared with the business" : "";
  return `${label}${what}${job}${shared}`;
}

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export default async function TaskPage({ params }: { params: Promise<{ taskId: string }> }) {
  const [{ taskId }, session] = await Promise.all([params, appTaskActor()]);
  if (!session) redirect(`/login?next=/tasks/${taskId}`);
  const found = await getTask(session.db, session.actor, taskId);
  if (!found.ok) notFound();
  const { task, activity } = found.value;
  const [members, fingerprint] = await Promise.all([
    listAssignableMembers(session.db, session.actor),
    tasksFingerprint(session.db, session.actor, task.job?.id),
  ]);
  const done = task.status === "complete";

  return (
    <FieldPageShell title={task.title} eyebrow="Task" backHref="/tasks" compact>
      <RefreshOnChange source={`/api/tasks/fingerprint${task.job ? `?job=${task.job.id}` : ""}`} fingerprint={fingerprint} every={20_000} />
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <section className="flex flex-wrap items-center gap-3 rounded-panel border border-line bg-surface p-4 text-sm">
          <span className="rounded-full border border-line px-3 py-1 font-semibold text-ink">{task.status_label}</span>
          {task.overdue ? <span className="font-semibold text-critical">Overdue</span> : null}
          <span className="inline-flex items-center gap-1 text-ink-muted">
            {task.visibility === "private" ? <Lock className="h-4 w-4" aria-hidden /> : <Users className="h-4 w-4" aria-hidden />}
            {task.visibility === "private" ? "Private to you and the assignee" : "Visible to your business"}
          </span>
          {task.job ? (
            <Link href={`/jobs/${task.job.number}`} className="inline-flex items-center gap-1 text-ink-muted hover:text-ink hover:underline">
              <Briefcase className="h-4 w-4" aria-hidden />
              {task.job.label}
            </Link>
          ) : null}
          {task.archived_at ? <span className="font-semibold text-caution">Archived</span> : null}
        </section>

        {task.archived_at ? (
          <form action={archiveTaskAction} className="rounded-panel border border-line bg-surface p-4">
            <input type="hidden" name="task_id" value={task.id} />
            <input type="hidden" name="version" value={task.version} />
            <input type="hidden" name="restore" value="yes" />
            <p className="text-sm text-ink-muted">This task is archived. It is kept with its history.</p>
            <button type="submit" className="tap-target mt-2 min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink">
              Restore
            </button>
          </form>
        ) : (
          <>
            <section aria-labelledby="edit-heading" className="rounded-panel border border-line bg-surface p-4">
              <h2 id="edit-heading" className="mb-3 text-sm font-semibold text-ink">
                Details
              </h2>
              <TaskEditForm task={task} members={members} />
            </section>

            <section aria-labelledby="job-heading" className="rounded-panel border border-line bg-surface p-4">
              <h2 id="job-heading" className="mb-3 text-sm font-semibold text-ink">
                Job
              </h2>
              <p className="mb-3 text-sm text-ink-muted">
                {task.job ? (
                  <>
                    On <Link href={`/jobs/${task.job.number}`} className="font-semibold text-ink underline">{task.job.label}</Link>. Completing this task does not change the job.
                  </>
                ) : (
                  "Not on a job."
                )}
              </p>
              <TaskJobForm
                taskId={task.id}
                version={task.version}
                currentJob={task.job?.label ?? null}
                currentJobNumber={task.job?.number ?? null}
                isPrivate={task.visibility === "private"}
              />
            </section>

            <div className="flex flex-wrap gap-2">
              <form action={toggleTaskComplete}>
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="version" value={task.version} />
                <input type="hidden" name="done" value={done ? "yes" : "no"} />
                {task.job ? <input type="hidden" name="job_number" value={task.job.number} /> : null}
                <button type="submit" className="tap-target min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink">
                  {done || task.status === "canceled" ? "Reopen" : "Mark complete"}
                </button>
              </form>
              <form action={archiveTaskAction}>
                <input type="hidden" name="task_id" value={task.id} />
                <input type="hidden" name="version" value={task.version} />
                {task.job ? <input type="hidden" name="job_number" value={task.job.number} /> : null}
                <button type="submit" className="tap-target min-h-11 rounded-control px-4 text-sm font-semibold text-ink-muted hover:text-ink">
                  Archive
                </button>
              </form>
            </div>
          </>
        )}

        <section aria-labelledby="history-heading" className="rounded-panel border border-line bg-surface p-4">
          <h2 id="history-heading" className="mb-3 text-sm font-semibold text-ink">
            History
          </h2>
          {activity.length === 0 ? (
            <p className="text-sm text-ink-muted">No history yet.</p>
          ) : (
            <ol className="grid gap-2 text-sm">
              {activity.map((item) => (
                <li key={item.id} className="flex flex-wrap justify-between gap-x-3 border-b border-line/60 pb-2 last:border-0">
                  <span className="text-ink">{describe(item)}</span>
                  <span className="text-xs text-ink-faint">
                    {item.actor_type === "user" ? (item.actor_name ?? "Someone") : item.actor_type === "assistant" ? "Assistant" : "Volteira"}
                    {item.via === "chatgpt" ? " via ChatGPT/Claude" : ""} · {when(item.created_at, session.actor.timeZone)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </FieldPageShell>
  );
}
