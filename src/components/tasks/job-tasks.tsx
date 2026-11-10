import Link from "next/link";
import { ListChecks } from "lucide-react";

import { RefreshOnChange } from "@/components/refresh-on-change";
import { TaskQuickAdd } from "@/components/tasks/task-quick-add";
import { TaskRow } from "@/components/tasks/task-row";
import { appTaskActor } from "@/lib/task-actor";
import { jobTaskCounts, listAssignableMembers, listTasks, resolveJob, tasksFingerprint } from "@/lib/tasks-service";

/**
 * A job's Tasks: the same task records as the Tasks page and ChatGPT, filtered
 * to this job. Tasks added here are made on the job and are visible to the
 * business, which the section says. Completing them never changes the job.
 */
export async function JobTasks({ jobNumber }: { jobNumber: string }) {
  const session = await appTaskActor();
  if (!session) return null;
  const job = await resolveJob(session.db, session.actor, jobNumber);
  if (!job.ok) return null;

  const [open, done, counts, members, fingerprint] = await Promise.all([
    listTasks(session.db, session.actor, { jobId: job.value.id, view: "all", limit: 100 }),
    listTasks(session.db, session.actor, { jobId: job.value.id, view: "completed", limit: 20 }),
    jobTaskCounts(session.db, session.actor, job.value.id),
    listAssignableMembers(session.db, session.actor),
    tasksFingerprint(session.db, session.actor, job.value.id),
  ]);
  const openTasks = open.ok ? open.value.tasks : [];
  const doneTasks = done.ok ? done.value.tasks : [];

  return (
    <section aria-labelledby="job-tasks-heading" className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
      <RefreshOnChange source={`/api/tasks/fingerprint?job=${job.value.id}`} fingerprint={fingerprint} every={20_000} />
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 id="job-tasks-heading" className="inline-flex items-center gap-2 text-sm font-semibold">
          <ListChecks className="h-4 w-4 text-brand" aria-hidden />
          Tasks
          {counts.total > 0 ? (
            <span className="text-xs font-normal text-ink-muted">
              {counts.done} of {counts.total} done
            </span>
          ) : null}
        </h2>
        <Link href={`/tasks?view=all&job=${jobNumber}`} className="tap-target inline-flex min-h-11 items-center text-sm font-semibold text-brand">
          Open in Tasks
        </Link>
      </div>

      <TaskQuickAdd job={jobNumber} jobNumber={jobNumber} members={members} placeholder="Add a task for this job" timeZone={session.actor.timeZone} />
      <p className="mt-2 text-xs text-ink-faint">Tasks on this job are visible to everyone in your business. Finishing them does not finish the job.</p>

      {openTasks.length === 0 && doneTasks.length === 0 ? (
        <p className="mt-3 text-sm text-ink-muted">No tasks on this job yet. To move an existing task here, open it and link it to job #{jobNumber}.</p>
      ) : (
        <ul className="mt-3 grid gap-2" aria-label="Open tasks on this job">
          {openTasks.map((task) => (
            <TaskRow key={task.id} task={task} showJob={false} />
          ))}
        </ul>
      )}
      {doneTasks.length ? (
        <details className="mt-3">
          <summary className="tap-target cursor-pointer text-sm font-semibold text-ink-muted">Done ({doneTasks.length})</summary>
          <ul className="mt-2 grid gap-2">
            {doneTasks.map((task) => (
              <TaskRow key={task.id} task={task} showJob={false} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}
