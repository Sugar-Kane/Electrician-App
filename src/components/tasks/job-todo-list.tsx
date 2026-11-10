import Link from "next/link";
import { Briefcase, CalendarClock, ChevronRight } from "lucide-react";

import type { DayJob, JobTodo } from "@/lib/job-todos";

const KIND_LABELS: Record<JobTodo["kind"], string> = {
  bill_job: "Bill",
  send_invoice: "Send invoice",
  chase_invoice: "Overdue",
  answer_request: "Booking request",
  price_job: "Price",
};

/**
 * What the jobs say needs doing, beside the tasks people wrote: today's jobs
 * and the job to-dos. Worked out from the jobs each time the page loads, so it
 * is always in step with them; finishing the step on the job clears it here.
 */
export function JobTodoList({ jobs, todos, dateLabel }: { jobs: DayJob[]; todos: JobTodo[]; dateLabel: string }) {
  if (jobs.length === 0 && todos.length === 0) return null;
  return (
    <section aria-labelledby="job-todos-heading" className="rounded-panel border border-line bg-surface p-3">
      <h2 id="job-todos-heading" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Briefcase className="h-4 w-4 text-brand" aria-hidden />
        From your jobs
      </h2>
      {jobs.length > 0 ? (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{dateLabel}</p>
          <ul className="mb-3 grid gap-1.5">
            {jobs.map((job) => (
              <li key={job.id}>
                <Link href={job.href} className="tap-row flex min-h-11 items-center gap-2 rounded-control border border-line px-3 py-2 text-sm hover:bg-white/5">
                  <CalendarClock className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {job.window} · #{job.number} {job.customer}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">
                      {job.status}
                      {job.address ? ` · ${job.address}` : ""}
                      {job.partsReady ? " · parts ready" : ""}
                    </span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      {todos.length > 0 ? (
        <ul className="grid gap-1.5" aria-label="Job to-dos">
          {todos.slice(0, 30).map((todo, index) => (
            <li key={`${todo.kind}-${todo.jobNumber ?? ""}-${index}`}>
              <Link href={todo.href} className="tap-row flex min-h-11 items-start gap-2 rounded-control border border-line px-3 py-2 text-sm hover:bg-white/5">
                <span className="mt-0.5 shrink-0 rounded-full border border-line px-2 py-0.5 text-[11px] font-semibold text-ink">{KIND_LABELS[todo.kind]}</span>
                <span className="min-w-0 flex-1 text-ink">{todo.title}</span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
