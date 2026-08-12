import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { DayView, MonthView, WeekView } from "@/components/schedule-views";
import {
  formatDayLabel,
  fullWeekOf,
  isIsoDate,
  monthGridOf,
  monthLabel,
  shiftDays,
  shiftMonths,
  todayInZone,
  workWeekLabel,
  workWeekOf,
} from "@/lib/calendar";
import { getJobs } from "@/lib/job-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";

// The schedule is a view of "now", so it must never be cached into showing a
// week that has already passed.
export const dynamic = "force-dynamic";

const VIEWS = [
  { value: "day", label: "Day" },
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
] as const;

type View = (typeof VIEWS)[number]["value"];

function asView(value: string): View {
  return VIEWS.some((view) => view.value === value) ? (value as View) : "day";
}

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
  const view = asView(query.view ?? "");

  const { jobs: allJobs } = await getJobs();

  const weekStrip = workWeekOf(selectedDate, today);
  const week = fullWeekOf(selectedDate, today);
  const monthCells = monthGridOf(selectedDate, today);

  // Each view pages by its own unit. A month view whose arrows moved a week at
  // a time would take four taps to do the thing the arrow appears to do.
  const step = view === "month" ? 30 : 7;
  const previous =
    view === "month" ? shiftMonths(selectedDate, -1) : shiftDays(selectedDate, -step);
  const next = view === "month" ? shiftMonths(selectedDate, 1) : shiftDays(selectedDate, step);

  const heading =
    view === "month"
      ? monthLabel(selectedDate)
      : view === "week"
        ? workWeekLabel(week)
        : formatDayLabel(selectedDate);

  const href = (date: string, nextView: View) =>
    `/schedule?date=${date}&view=${nextView}`;

  return (
    <FieldPageShell
      title="Jobs"
      eyebrow="Work"
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-control border border-line p-1"
          role="tablist"
          aria-label="Choose a schedule view"
        >
          {VIEWS.map((option) => (
            <Link
              key={option.value}
              href={href(selectedDate, option.value)}
              role="tab"
              aria-selected={view === option.value}
              className={`tap-target inline-flex min-w-16 items-center justify-center rounded-chip px-3 text-xs font-semibold ${
                view === option.value ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink"
              }`}
            >
              {option.label}
            </Link>
          ))}
        </div>

        <Link
          href="/jobs/new"
          className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
        >
          <Plus className="h-4 w-4" aria-hidden />
          Job
        </Link>
      </div>

      <section className="rounded-panel border border-line bg-surface p-3 sm:p-5">
        <div className="flex items-center justify-between gap-2 px-1">
          <div className="min-w-0">
            <h2 className="truncate text-lg font-semibold">{heading}</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link
              href={href(previous, view)}
              aria-label={`Previous ${view}`}
              className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line bg-white/[0.03] text-ink-muted active:bg-white/10"
            >
              <ChevronLeft className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href={href(next, view)}
              aria-label={`Next ${view}`}
              className="tap-target grid h-11 w-11 place-items-center rounded-control border border-line bg-white/[0.03] text-ink-muted active:bg-white/10"
            >
              <ChevronRight className="h-5 w-5" aria-hidden />
            </Link>
            <Link
              href={href(today, view)}
              aria-label="Back to today"
              className="tap-target grid h-11 w-11 place-items-center rounded-control bg-brand text-on-brand"
            >
              <CalendarDays className="h-5 w-5" aria-hidden />
            </Link>
          </div>
        </div>

        {view === "day" ? (
          <div className="mt-4 grid grid-cols-5 gap-1.5" aria-label="Choose a schedule date">
            {weekStrip.map((item) => {
              const count = allJobs.filter(
                (job) => job.date === item.date && job.status !== "Canceled",
              ).length;
              const selected = item.date === selectedDate;
              return (
                <Link
                  key={item.date}
                  href={href(item.date, "day")}
                  aria-current={selected ? "date" : undefined}
                  className={`tap-target flex min-h-[76px] flex-col items-center justify-center rounded-control border px-1 ${
                    selected
                      ? "border-brand bg-brand text-on-brand"
                      : item.isToday
                        ? "border-brand/50 bg-white/[0.03] text-ink"
                        : "border-line bg-white/[0.03] text-ink-muted active:bg-white/10"
                  }`}
                >
                  <span className="text-[10px] font-semibold uppercase">{item.weekday}</span>
                  <span className="text-xl font-semibold">{item.day}</span>
                  <span className={`text-[9px] ${selected ? "opacity-70" : "text-ink-faint"}`}>
                    {item.isToday ? "Today" : `${count || "No"} ${count === 1 ? "job" : "jobs"}`}
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}
      </section>

      <div className="mt-4">
        {view === "day" ? (
          <DayView
            jobs={allJobs.filter((job) => job.date === selectedDate)}
            date={selectedDate}
          />
        ) : view === "week" ? (
          <WeekView days={week} jobs={allJobs} today={today} />
        ) : (
          <MonthView cells={monthCells} jobs={allJobs} selectedDate={selectedDate} />
        )}
      </div>
    </FieldPageShell>
  );
}
