import Link from "next/link";
import { ChevronRight, Clock3, MapPin, UserRound } from "lucide-react";

import type { CalendarDay, MonthCell } from "@/lib/calendar";
import { formatDayLabel } from "@/lib/calendar";
import type { PilotJob } from "@/lib/pilot-data";

/**
 * The week and the month.
 *
 * The schedule could only ever show one day. That answers "what am I doing
 * now" and none of the questions a business actually plans around — how full is
 * Thursday, is next week worth taking another job in, did anything get booked
 * over the holiday.
 *
 * Both views are rendered from the same already-fetched job list as the day
 * view. Paging between them is a link, not a fetch, and no view has its own
 * idea of what a day contains.
 */

const statusDot: Record<string, string> = {
  "In progress": "bg-blue-400",
  Scheduled: "bg-amber-400",
  Pending: "bg-slate-400",
  Canceled: "bg-rose-400",
  Completed: "bg-emerald-400",
};

/** Canceled work is not work. It stays visible, but it never inflates a count. */
function countable(jobs: PilotJob[]): PilotJob[] {
  return jobs.filter((job) => job.status !== "Canceled");
}

export function WeekView({
  days,
  jobs,
  today,
}: {
  days: CalendarDay[];
  jobs: PilotJob[];
  today: string;
}) {
  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {days.map((day) => {
        const dayJobs = jobs.filter((job) => job.date === day.date);
        const active = countable(dayJobs);

        return (
          <section
            key={day.date}
            className={`rounded-control border p-3 ${
              day.isToday ? "border-brand/50 bg-brand/[0.05]" : "border-line bg-surface"
            }`}
          >
            <header className="flex items-baseline justify-between gap-2">
              <Link
                href={`/schedule?date=${day.date}`}
                className="text-sm font-semibold hover:text-brand"
              >
                {day.weekday} {day.day}
              </Link>
              <span className="text-[10px] text-ink-faint">
                {active.length || "No"} {active.length === 1 ? "job" : "jobs"}
              </span>
            </header>

            <div className="mt-2 space-y-1.5">
              {dayJobs.map((job) => (
                <Link
                  key={job.id}
                  href={`/jobs/${job.id}`}
                  className={`block rounded-chip border border-line px-2.5 py-2 active:bg-white/5 ${
                    job.status === "Canceled" ? "opacity-55" : ""
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <span
                      className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot[job.status] ?? "bg-slate-400"}`}
                      aria-hidden
                    />
                    <span className="truncate text-[11px] font-semibold">{job.time}</span>
                  </span>
                  <span
                    className={`mt-0.5 block truncate text-[11px] text-ink-muted ${
                      job.status === "Canceled" ? "line-through" : ""
                    }`}
                  >
                    {job.customer}
                  </span>
                </Link>
              ))}

              {dayJobs.length === 0 ? (
                <p className="rounded-chip border border-dashed border-line px-2.5 py-3 text-center text-[10px] text-ink-faint">
                  Open
                </p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function MonthView({
  cells,
  jobs,
  selectedDate,
}: {
  cells: MonthCell[];
  jobs: PilotJob[];
  selectedDate: string;
}) {
  return (
    <div className="rounded-panel border border-line bg-surface p-3 sm:p-4">
      <div className="grid grid-cols-7 gap-1 pb-2">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((label) => (
          <div key={label} className="text-center text-[10px] font-semibold text-ink-faint">
            {label}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1">
        {cells.map((cell) => {
          const active = countable(jobs.filter((job) => job.date === cell.date));
          const selected = cell.date === selectedDate;

          return (
            <Link
              key={cell.date}
              href={`/schedule?date=${cell.date}`}
              aria-current={selected ? "date" : undefined}
              className={`flex min-h-[76px] flex-col rounded-chip border p-1 transition sm:min-h-[68px] sm:p-1.5 ${
                selected
                  ? "border-brand bg-brand/15"
                  : cell.isToday
                    ? "border-brand/50 bg-white/[0.03]"
                    : "border-line active:bg-white/5"
              } ${cell.inMonth ? "" : "opacity-40"}`}
            >
              <span className="text-[11px] font-semibold">{cell.day}</span>

              {active.length > 0 ? (
                <span className="mt-auto space-y-0.5">
                  {active.slice(0, 2).map((job) => (
                    <span
                      key={job.id}
                      className="block truncate rounded-[4px] bg-white/[0.07] px-1 text-[9px] leading-4 text-ink-muted"
                    >
                      <span className="sm:hidden">{job.time}</span>
                      <span className="hidden sm:inline">
                        {job.time} {job.customer}
                      </span>
                    </span>
                  ))}
                  {active.length > 2 ? (
                    <span className="block px-1 text-[9px] text-ink-faint">
                      +{active.length - 2} more
                    </span>
                  ) : null}
                </span>
              ) : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}

export function DayView({ jobs, date }: { jobs: PilotJob[]; date: string }) {
  const statusStyles: Record<string, string> = {
    "In progress": "border-blue-400/30 bg-blue-400/10 text-blue-300",
    Scheduled: "border-amber-400/30 bg-amber-400/10 text-amber-300",
    Pending: "border-slate-400/30 bg-slate-400/10 text-ink-muted",
    Canceled: "border-rose-400/30 bg-rose-400/10 text-rose-200",
    Completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
  };

  return (
    <section className="space-y-3" aria-labelledby="scheduled-jobs-heading">
      <div className="flex items-end justify-between px-1">
        <div>
          <p className="text-xs text-ink-faint">Selected day</p>
          <h2 id="scheduled-jobs-heading" className="text-lg font-semibold">
            {formatDayLabel(date)}
          </h2>
        </div>
        <span className="text-xs text-ink-muted">
          {jobs.length} {jobs.length === 1 ? "job" : "jobs"}
        </span>
      </div>

      {jobs.map((job) => (
        <Link
          key={job.id}
          href={`/jobs/${job.id}`}
          className="tap-card block rounded-panel border border-line bg-surface p-4 active:bg-raised"
        >
          <div className="flex items-start gap-3">
            <div className="w-16 shrink-0">
              <p className="text-sm font-semibold text-brand">{job.time}</p>
              <p className="mt-1 text-[10px] text-ink-faint">to {job.endTime}</p>
            </div>
            <div className="min-w-0 flex-1 border-l border-line pl-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-base font-semibold">{job.customer}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    #{job.id} · {job.workType}
                  </p>
                </div>
                <ChevronRight className="mt-1 h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
              </div>
              <div className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-3">
                <span className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  <span className="truncate">{job.city}</span>
                </span>
                <span className="flex items-center gap-2">
                  <UserRound className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  {job.technician}
                </span>
                <span className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                  {job.endTime}
                </span>
              </div>
              <span
                className={`mt-3 inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-semibold ${statusStyles[job.status] ?? ""}`}
              >
                {job.status}
              </span>
            </div>
          </div>
        </Link>
      ))}

      {jobs.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">
          Nothing booked for this day.
        </div>
      ) : null}
    </section>
  );
}
