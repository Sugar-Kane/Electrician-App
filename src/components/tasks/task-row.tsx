import Link from "next/link";
import { AlertTriangle, Bot, Briefcase, CheckCircle2, Circle, Clock, Lock, UserRound } from "lucide-react";

import { toggleTaskComplete } from "@/app/tasks/actions";
import type { TaskSummary } from "@/lib/tasks-service";

/**
 * One task in a list. Every state is said in words or an icon with a label,
 * never by colour alone: overdue, waiting, private, the job and who has it.
 */
export function TaskRow({ task, showJob = true }: { task: TaskSummary; showJob?: boolean }) {
  const done = task.status === "complete";
  const closed = done || task.status === "canceled";
  return (
    <li className="flex items-start gap-3 rounded-control border border-line bg-surface px-3 py-3">
      <form action={toggleTaskComplete}>
        <input type="hidden" name="task_id" value={task.id} />
        <input type="hidden" name="version" value={task.version} />
        <input type="hidden" name="done" value={done ? "yes" : "no"} />
        {task.job ? <input type="hidden" name="job_number" value={task.job.number} /> : null}
        <button
          type="submit"
          className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-full text-ink-muted hover:text-brand"
          aria-label={done ? `Reopen "${task.title}"` : `Complete "${task.title}"`}
          title={done ? "Reopen" : "Complete"}
        >
          {done ? <CheckCircle2 className="h-6 w-6 text-positive" aria-hidden /> : <Circle className="h-6 w-6" aria-hidden />}
        </button>
      </form>

      <div className="min-w-0 flex-1 py-1">
        <Link
          href={`/tasks/${task.id}`}
          className={`block break-words text-sm font-semibold hover:underline ${closed ? "text-ink-faint line-through" : "text-ink"}`}
        >
          {task.title}
        </Link>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
          {task.due_label ? (
            <span className={`inline-flex items-center gap-1 ${task.overdue ? "font-semibold text-critical" : ""}`}>
              {task.overdue ? <AlertTriangle className="h-3.5 w-3.5" aria-hidden /> : <Clock className="h-3.5 w-3.5" aria-hidden />}
              {task.overdue ? `Overdue · ${task.due_label}` : task.due_label}
            </span>
          ) : null}
          {showJob && task.job ? (
            <Link href={`/jobs/${task.job.number}`} className="inline-flex max-w-full items-center gap-1 truncate hover:text-ink hover:underline">
              <Briefcase className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{task.job.label}</span>
            </Link>
          ) : null}
          {task.assignee.type === "assistant" ? (
            <span className="inline-flex items-center gap-1">
              <Bot className="h-3.5 w-3.5" aria-hidden />
              Assistant
            </span>
          ) : task.assignee.name && task.assignee.name !== "You" ? (
            <span className="inline-flex items-center gap-1">
              <UserRound className="h-3.5 w-3.5" aria-hidden />
              {task.assignee.name}
            </span>
          ) : null}
          {task.needs_approval || task.needs_input || task.status === "in_progress" || task.status === "canceled" ? (
            <span className="rounded-full border border-line px-2 py-0.5 font-semibold text-ink">{task.status_label}</span>
          ) : null}
          {task.visibility === "private" ? (
            <span className="inline-flex items-center gap-1" title="Only you and the person it is assigned to can see this">
              <Lock className="h-3.5 w-3.5" aria-hidden />
              Private
            </span>
          ) : null}
        </div>
      </div>
    </li>
  );
}
