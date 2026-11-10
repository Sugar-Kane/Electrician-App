import Link from "next/link";
import { DateField } from "@/components/ui/date-field";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { RefreshOnChange } from "@/components/refresh-on-change";
import { TaskQuickAdd } from "@/components/tasks/task-quick-add";
import { TaskRow } from "@/components/tasks/task-row";
import { inputClass } from "@/components/ui/field";
import { appTaskActor } from "@/lib/task-actor";
import {
  TASK_STATUSES,
  TASK_STATUS_LABELS,
  dueLabel,
  groupByDate,
  isTaskFilter,
  isTaskStatus,
  isTaskView,
  type TaskFilter,
  type TaskView,
} from "@/lib/task-rules";
import { listAssignableMembers, listNotifications, listTasks, tasksFingerprint } from "@/lib/tasks-service";
import { TaskNotifications } from "@/components/tasks/task-notifications";
import { JobTodoList } from "@/components/tasks/job-todo-list";
import { dayJob, dayJobs } from "@/lib/job-todos";
import { loadNeedsAction } from "@/lib/needs-action";
import { SelectField } from "@/components/ui/select-field";

export const dynamic = "force-dynamic";

/**
 * Tasks: to-dos for you, your team and later your assistant. The same records
 * as each job's Tasks section and the ChatGPT/Claude connection.
 *
 * The view, filters and search live in the address, so opening a task and
 * coming back lands on the same list.
 */

const VIEW_LABELS: Record<TaskView, string> = { today: "Today", upcoming: "Upcoming", all: "All tasks", completed: "Completed" };
const FILTER_LABELS: Record<TaskFilter, string> = {
  mine: "Assigned to me",
  ai: "Assigned to AI",
  waiting_input: "Waiting for input",
  waiting_approval: "Waiting for approval",
  overdue: "Overdue",
};
const EMPTY: Record<TaskView, string> = {
  today: "Nothing due today, nothing overdue, and nothing waiting on you.",
  upcoming: "No tasks with a future due date.",
  all: "No open tasks. Add one above, or ask ChatGPT or Claude to.",
  completed: "No completed tasks yet.",
};

type Params = { view?: string; f?: string | string[]; q?: string; job?: string; status?: string; from?: string; to?: string };

function href(base: Params, change: Partial<Params>): string {
  const merged = { ...base, ...change };
  const params = new URLSearchParams();
  if (merged.view && merged.view !== "today") params.set("view", merged.view);
  for (const filter of [merged.f ?? []].flat()) params.append("f", filter);
  for (const key of ["q", "job", "status", "from", "to"] as const) if (merged[key]) params.set(key, String(merged[key]));
  const search = params.toString();
  return search ? `/tasks?${search}` : "/tasks";
}

export default async function TasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  const [params, session] = await Promise.all([searchParams, appTaskActor()]);
  if (!session) redirect("/login?next=/tasks");

  const view: TaskView = isTaskView(params.view ?? "") ? (params.view as TaskView) : "today";
  const filters = [params.f ?? []].flat().filter(isTaskFilter);
  const status = isTaskStatus(params.status ?? "") ? params.status : undefined;
  const [listed, members, fingerprint, notices, fromJobs] = await Promise.all([
    listTasks(session.db, session.actor, {
      view,
      filters,
      q: params.q,
      job: params.job || undefined,
      status: status as never,
      from: params.from || undefined,
      to: params.to || undefined,
      limit: 200,
    }),
    listAssignableMembers(session.db, session.actor),
    tasksFingerprint(session.db, session.actor),
    listNotifications(session.db, session.actor, { limit: 8 }),
    // The home screen's "Needs your action" and today's jobs, on the Today view.
    view === "today"
      ? Promise.all([
          dayJobs(session.db, session.actor.organizationId, session.actor.timeZone),
          loadNeedsAction(session.db, session.actor.organizationId, session.actor.timeZone),
        ])
      : Promise.resolve(null),
  ]);

  const base: Params = { view, f: filters, q: params.q, job: params.job, status, from: params.from, to: params.to };
  const tasks = listed.ok ? listed.value.tasks : [];
  const zone = session.actor.timeZone;

  return (
    <FieldPageShell title="Tasks" eyebrow="Work" description="Your to-dos and your team's. The same list ChatGPT and Claude see." compact>
      <RefreshOnChange source="/api/tasks/fingerprint" fingerprint={fingerprint} every={20_000} />
      <div className="mx-auto grid w-full max-w-3xl gap-4">
        <TaskNotifications notifications={notices.notifications} unread={notices.unread} timeZone={session.actor.timeZone} />
        <TaskQuickAdd members={members} timeZone={zone} />
        {fromJobs ? (
          <JobTodoList
            jobs={fromJobs[0].jobs.map((job) => dayJob(job, zone))}
            items={fromJobs[1].items}
            dateLabel={`Today's jobs · ${dueLabel(fromJobs[0].date, null, zone)}`}
          />
        ) : null}

        <nav aria-label="Task views" className="flex gap-1 overflow-x-auto rounded-control border border-line p-1">
          {(Object.keys(VIEW_LABELS) as TaskView[]).map((option) => (
            <Link
              key={option}
              href={href(base, { view: option })}
              aria-current={option === view ? "page" : undefined}
              className={`tap-target inline-flex min-h-10 shrink-0 items-center rounded-chip px-3 text-sm font-semibold ${
                option === view ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink"
              }`}
            >
              {VIEW_LABELS[option]}
            </Link>
          ))}
        </nav>

        <details className="rounded-control border border-line bg-surface p-3" open={Boolean(filters.length || params.q || params.job || status || params.from || params.to)}>
          <summary className="tap-target cursor-pointer text-sm font-semibold text-ink">Search and filter</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {(Object.keys(FILTER_LABELS) as TaskFilter[]).map((filter) => {
              const on = filters.includes(filter);
              return (
                <Link
                  key={filter}
                  href={href(base, { f: on ? filters.filter((item) => item !== filter) : [...filters, filter] })}
                  aria-pressed={on}
                  className={`tap-target inline-flex min-h-9 items-center rounded-full border px-3 text-xs font-semibold ${
                    on ? "border-brand bg-brand/15 text-ink" : "border-line text-ink-muted hover:text-ink"
                  }`}
                >
                  {on ? "✓ " : ""}
                  {FILTER_LABELS[filter]}
                </Link>
              );
            })}
          </div>
          <form action="/tasks" className="mt-3 grid gap-3 sm:grid-cols-2">
            {view !== "today" ? <input type="hidden" name="view" value={view} /> : null}
            {filters.map((filter) => (
              <input key={filter} type="hidden" name="f" value={filter} />
            ))}
            <label className="grid gap-1 text-xs font-semibold text-ink-muted sm:col-span-2">
              Search
              <span className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
                <input name="q" defaultValue={params.q ?? ""} placeholder="Words in the title or notes" className={`${inputClass} pl-9`} />
              </span>
            </label>
            <label className="grid gap-1 text-xs font-semibold text-ink-muted">
              Job
              <input name="job" defaultValue={params.job ?? ""} placeholder="Job number or customer" className={inputClass} />
            </label>
            <div className="grid gap-1 text-xs font-semibold text-ink-muted">
              <span>Status</span>
              <SelectField
                name="status"
                label="Status"
                defaultValue={status ?? ""}
                choices={[{ value: "", label: "Any" }, ...TASK_STATUSES.map((option) => ({ value: option, label: TASK_STATUS_LABELS[option] }))]}
              />
            </div>
            <div className="grid gap-1 text-xs font-semibold text-ink-muted">
              <span>Due from</span>
              <DateField name="from" label="Due from" defaultValue={params.from ?? ""} timeZone={zone} placeholder="Any day" />
            </div>
            <div className="grid gap-1 text-xs font-semibold text-ink-muted">
              <span>Due to</span>
              <DateField name="to" label="Due to" defaultValue={params.to ?? ""} timeZone={zone} placeholder="Any day" />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button type="submit" className="tap-target min-h-11 rounded-control border border-line bg-raised px-4 text-sm font-semibold text-ink">
                Apply
              </button>
              <Link href={href({ view }, {})} className="tap-target inline-flex min-h-11 items-center rounded-control px-4 text-sm font-semibold text-ink-muted hover:text-ink">
                Clear
              </Link>
            </div>
          </form>
        </details>

        {!listed.ok ? (
          <p role="alert" className="rounded-control border border-critical/30 bg-critical-bg p-3 text-sm text-critical">
            {listed.error.message}
          </p>
        ) : tasks.length === 0 ? (
          <p className="rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">{EMPTY[view]}</p>
        ) : view === "upcoming" ? (
          groupByDate(tasks).map((group) => (
            <section key={group.date} aria-labelledby={`day-${group.date}`}>
              <h2 id={`day-${group.date}`} className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-faint">
                {group.date ? dueLabel(group.date, null, zone) : "No date"}
              </h2>
              <ul className="grid gap-2">
                {group.tasks.map((task) => (
                  <TaskRow key={task.id} task={task} />
                ))}
              </ul>
            </section>
          ))
        ) : (
          <ul className="grid gap-2" aria-label={VIEW_LABELS[view]}>
            {tasks.map((task) => (
              <TaskRow key={task.id} task={task} />
            ))}
          </ul>
        )}
        {listed.ok && listed.value.total > tasks.length ? (
          <p className="text-center text-xs text-ink-faint">Showing the first {tasks.length} of {listed.value.total}. Narrow it with search or filters.</p>
        ) : null}
      </div>
    </FieldPageShell>
  );
}
