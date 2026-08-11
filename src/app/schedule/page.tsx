import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock3, MapPin, UserRound } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import {
  formatDayLabel,
  isIsoDate,
  shiftDays,
  todayInZone,
  workWeekLabel,
  workWeekOf,
} from "@/lib/calendar";
import { getJobs } from "@/lib/job-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";

const statusStyles = {
  "In progress": "border-blue-400/30 bg-blue-400/10 text-blue-300",
  Scheduled: "border-amber-400/30 bg-amber-400/10 text-amber-300",
  Pending: "border-slate-400/30 bg-slate-400/10 text-slate-300",
  Completed: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300",
};

// The schedule is a view of "now", so it must never be cached into showing a
// week that has already passed.
export const dynamic = "force-dynamic";

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string; view?: string }>;
}) {
  const [query, timeZone] = await Promise.all([searchParams, getOrganizationTimezone()]);

  // Today in the business's timezone — not the server's, which is UTC in
  // production and would roll the schedule over in the middle of the evening.
  const today = todayInZone(timeZone);
  const requested = query.date ?? "";
  const selectedDate = isIsoDate(requested) ? requested : today;

  const calendarDays = workWeekOf(selectedDate, today);
  const previousWeek = shiftDays(calendarDays[0]!.date, -7);
  const nextWeek = shiftDays(calendarDays[0]!.date, 7);

  const { jobs: allJobs } = await getJobs();
  const jobs = allJobs.filter((job) => job.date === selectedDate);

  return (
    <FieldPageShell title="Schedule" eyebrow="Calendar view" description="Tap any job to open the customer, address, scope, documents, material needs, and navigation.">
      <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-3 sm:p-5">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <p className="text-xs text-slate-400">Work week</p>
            <h2 className="mt-0.5 truncate text-lg font-semibold">{workWeekLabel(calendarDays)}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href={`/schedule?date=${previousWeek}`}
              aria-label="Previous week"
              className="tap-target grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-300 active:bg-white/10"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href={`/schedule?date=${nextWeek}`}
              aria-label="Next week"
              className="tap-target grid h-11 w-11 place-items-center rounded-2xl border border-white/10 bg-white/[0.03] text-slate-300 active:bg-white/10"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href="/schedule"
              aria-label="Back to today"
              className="tap-target grid h-11 w-11 place-items-center rounded-2xl bg-[#ffc21c] text-[#071723]"
            >
              <CalendarDays className="h-5 w-5" aria-hidden />
            </Link>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Choose a schedule date">
          {calendarDays.map((item) => {
            const count = allJobs.filter((job) => job.date === item.date).length;
            const selected = item.date === selectedDate;
            return (
              <Link key={item.date} href={`/schedule?date=${item.date}`} className={`tap-target flex min-h-[76px] flex-col items-center justify-center rounded-2xl border px-1 ${selected ? "border-[#ffc21c] bg-[#ffc21c] text-[#071723]" : item.isToday ? "border-[#ffc21c]/50 bg-white/[0.03] text-slate-200" : "border-white/10 bg-white/[0.03] text-slate-300 active:bg-white/10"}`} aria-current={selected ? "date" : undefined}>
                <span className="text-[10px] font-semibold uppercase">{item.weekday}</span>
                <span className="text-xl font-semibold">{item.day}</span>
                <span className={`text-[9px] ${selected ? "text-[#071723]/70" : "text-slate-500"}`}>
                  {item.isToday ? "Today" : `${count || "No"} ${count === 1 ? "job" : "jobs"}`}
                </span>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="mt-4 space-y-3" aria-labelledby="scheduled-jobs-heading">
        <div className="flex items-end justify-between px-1"><div><p className="text-xs text-slate-500">{selectedDate === today ? "Today" : "Selected day"}</p><h2 id="scheduled-jobs-heading" className="text-lg font-semibold">{formatDayLabel(selectedDate)}</h2></div><span className="text-xs text-slate-400">{jobs.length} {jobs.length === 1 ? "job" : "jobs"}</span></div>
        {jobs.map((job) => (
          <Link key={job.id} href={`/jobs/${job.id}`} className="tap-card block rounded-3xl border border-white/10 bg-[#0b1b27] p-4 active:bg-[#102635]">
            <div className="flex items-start gap-3">
              <div className="w-16 shrink-0"><p className="text-sm font-semibold text-[#ffc21c]">{job.time}</p><p className="mt-1 text-[10px] text-slate-500">to {job.endTime}</p></div>
              <div className="min-w-0 flex-1 border-l border-white/10 pl-3">
                <div className="flex items-start justify-between gap-2"><div><p className="text-base font-semibold">{job.customer}</p><p className="mt-0.5 text-xs text-slate-400">#{job.id} · {job.workType}</p></div><ChevronRight className="mt-1 h-5 w-5 shrink-0 text-slate-500" aria-hidden /></div>
                <div className="mt-3 grid gap-2 text-xs text-slate-300 sm:grid-cols-3">
                  <span className="flex items-center gap-2"><MapPin className="h-4 w-4 shrink-0 text-slate-500" aria-hidden /><span className="truncate">{job.city}</span></span>
                  <span className="flex items-center gap-2"><UserRound className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />{job.technician}</span>
                  <span className="flex items-center gap-2"><Clock3 className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />{job.endTime}</span>
                </div>
                <span className={`mt-3 inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-semibold ${statusStyles[job.status]}`}>{job.status}</span>
              </div>
            </div>
          </Link>
        ))}
        {jobs.length === 0 ? <div className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">No jobs are assigned yet. This day is open for scheduling.</div> : null}
      </section>
    </FieldPageShell>
  );
}
