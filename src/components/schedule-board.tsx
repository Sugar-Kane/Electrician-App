"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Plus } from "lucide-react";

import { DayView, MonthView, WeekView } from "@/components/schedule-views";
import {
  formatDayLabel,
  fullWeekOf,
  monthGridOf,
  monthLabel,
  shiftDays,
  shiftMonths,
  workWeekLabel,
} from "@/lib/calendar";
import type { PilotJob } from "@/lib/pilot-data";
import {
  SCHEDULE_VIEWS,
  daysPerStep,
  scheduleHref,
  type ScheduleView,
} from "@/lib/schedule-view";

/**
 * The schedule, switching views without going back to the server.
 *
 * Day, week and month are three readings of one list of jobs, and that list is
 * already on this page. They used to be three links to a `force-dynamic` route,
 * so every tap on Week was a round trip, a loading skeleton and a re-render of
 * a page whose data had not changed. On a phone on a driveway that is a second
 * of grey boxes to see the same jobs a different way.
 *
 * Paging is the same story: next week is a slice of the same array.
 *
 * Crew is the exception and stays a real navigation. It is not another view of
 * these jobs — it needs the roster, the hours and the time off, none of which
 * are here. Its tab is a link; the other three are buttons.
 */

export function ScheduleBoard({
  jobs,
  today,
  initialDate,
  initialView,
  crew,
}: {
  jobs: PilotJob[];
  /** Today in the business's zone, worked out on the server. */
  today: string;
  initialDate: string;
  initialView: ScheduleView;
  /** The crew tab, rendered on the server, or null on the other three. */
  crew: ReactNode;
}) {
  const [view, setView] = useState<ScheduleView>(initialView);
  const [date, setDate] = useState(initialDate);

  /*
   * Following a real navigation instead of ignoring it.
   *
   * `useState` takes its argument as a *starting* value, and the crew tab and
   * the crew arrows are `Link`s to this same route with different search
   * params. React keeps the component instance across that, so the server sent
   * a new week and a new view and this carried on drawing the old ones: the
   * Crew tab changed the URL and left the day strip on screen, and paging the
   * crew week moved the address bar while the heading stayed on the week
   * before.
   *
   * So the props are compared against the ones this was last rendered with, and
   * a difference means somebody navigated. Assigned during render rather than
   * in an effect — the state is wrong for this render, not for the next one,
   * and React re-runs the render before committing anything to the screen.
   */
  const [seen, setSeen] = useState({ view: initialView, date: initialDate });
  if (seen.view !== initialView || seen.date !== initialDate) {
    setSeen({ view: initialView, date: initialDate });
    setView(initialView);
    setDate(initialDate);
  }

  const week = fullWeekOf(date, today);
  const monthCells = monthGridOf(date, today);

  /*
   * The URL follows the view rather than driving it.
   *
   * `replaceState` rather than a router push: this is the same page showing the
   * same data a different way, so it does not deserve its own history entry —
   * and Back from the schedule should leave the schedule, not walk through
   * every tab that was tried on the way.
   */
  function go(nextDate: string, nextView: ScheduleView) {
    setDate(nextDate);
    setView(nextView);
    if (typeof window !== "undefined") {
      window.history.replaceState(null, "", scheduleHref(nextDate, nextView));
    }
  }

  /*
   * Each view pages by its own unit.
   *
   * Day used to page by seven, while the button said "Previous day" — so the
   * strip jumped a whole week and landed on the same weekday it started on,
   * which is why the highlight looked stuck to Monday.
   */
  const previous =
    view === "month" ? shiftMonths(date, -1) : shiftDays(date, -daysPerStep(view));
  const next = view === "month" ? shiftMonths(date, 1) : shiftDays(date, daysPerStep(view));

  const heading =
    view === "month"
      ? monthLabel(date)
      : view === "week" || view === "crew"
        ? workWeekLabel(week)
        : formatDayLabel(date);

  const stepLabel = view === "crew" ? "week" : view;

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div
          className="inline-flex rounded-control border border-line p-1"
          role="tablist"
          aria-label="Choose a schedule view"
        >
          {SCHEDULE_VIEWS.map((option) => {
            const selected = view === option.value;
            const className = `tap-target inline-flex min-w-16 items-center justify-center rounded-chip px-3 text-xs font-semibold ${
              selected ? "bg-brand text-on-brand" : "text-ink-muted hover:text-ink"
            }`;

            // Crew needs data this page does not hold, so reaching it is a
            // navigation. Leaving it is not — these jobs came back with it.
            if (option.value === "crew" && !selected) {
              return (
                <Link
                  key={option.value}
                  href={scheduleHref(date, "crew")}
                  prefetch
                  role="tab"
                  aria-selected={false}
                  className={className}
                >
                  {option.label}
                </Link>
              );
            }

            return (
              <button
                key={option.value}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => go(date, option.value)}
                className={className}
              >
                {option.label}
              </button>
            );
          })}
        </div>

        <Link
          href="/jobs/new"
          prefetch
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
            <Nav
              label={`Previous ${stepLabel}`}
              date={previous}
              view={view}
              onGo={go}
              icon={<ChevronLeft className="h-5 w-5" aria-hidden />}
            />
            <Nav
              label={`Next ${stepLabel}`}
              date={next}
              view={view}
              onGo={go}
              icon={<ChevronRight className="h-5 w-5" aria-hidden />}
            />
            <Nav
              label="Back to today"
              date={today}
              view={view}
              onGo={go}
              accent
              icon={<CalendarDays className="h-5 w-5" aria-hidden />}
            />
          </div>
        </div>

        {view === "day" ? (
          /*
           * Seven days, and scrollable rather than squeezed.
           *
           * The strip was Monday to Friday, so a Saturday call-out could not be
           * reached from it at all. Seven cells at 320px would be 35px across,
           * under the 44px a finger needs, so the row scrolls sideways instead
           * of shrinking.
           */
          <div className="-mx-1 mt-4 overflow-x-auto px-1 pb-1">
            <div
              className="grid min-w-max grid-cols-7 gap-1.5"
              aria-label="Choose a schedule date"
            >
              {week.map((item) => {
                const count = jobs.filter(
                  (job) => job.date === item.date && job.status !== "Canceled",
                ).length;
                const showing = item.date === date;

                /*
                 * The solid fill means today, and only today.
                 *
                 * It used to mean "the day being shown", so paging carried the
                 * yellow across the strip with it and the schedule looked like
                 * it had a different today every time you pressed an arrow. The
                 * day you are looking at is ringed instead — visible, but not
                 * pretending to be the date.
                 */
                const tone = item.isToday
                  ? "border-brand bg-brand text-on-brand"
                  : showing
                    ? "border-brand/60 bg-white/[0.06] text-ink"
                    : "border-line bg-white/[0.03] text-ink-muted active:bg-white/10";

                return (
                  <button
                    key={item.date}
                    type="button"
                    onClick={() => go(item.date, "day")}
                    aria-current={showing ? "date" : undefined}
                    className={`tap-target flex min-h-[76px] w-[46px] flex-col items-center justify-center rounded-control border px-1 sm:w-auto ${tone} ${
                      showing && !item.isToday ? "ring-1 ring-brand/60" : ""
                    }`}
                  >
                    <span className="text-[10px] font-semibold uppercase">{item.weekday}</span>
                    <span className="text-xl font-semibold">{item.day}</span>
                    <span
                      className={`text-[9px] ${item.isToday ? "opacity-70" : "text-ink-faint"}`}
                    >
                      {item.isToday ? "Today" : `${count || "No"} ${count === 1 ? "job" : "jobs"}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        ) : null}
      </section>

      <div className="mt-4">
        {view === "day" ? (
          <DayView jobs={jobs.filter((job) => job.date === date)} date={date} />
        ) : view === "week" ? (
          <WeekView days={week} jobs={jobs} today={today} onPickDay={(day) => go(day, "day")} />
        ) : view === "crew" ? (
          crew
        ) : (
          <MonthView
            cells={monthCells}
            jobs={jobs}
            selectedDate={date}
            onPickDay={(day) => go(day, "day")}
          />
        )}
      </div>
    </>
  );
}

function Nav({
  label,
  date,
  view,
  onGo,
  icon,
  accent,
}: {
  label: string;
  date: string;
  view: ScheduleView;
  onGo: (date: string, view: ScheduleView) => void;
  icon: ReactNode;
  accent?: boolean;
}) {
  /*
   * A link on the crew tab, a button everywhere else.
   *
   * Paging the crew week needs hours and time off fetched for the new week, so
   * that one has to go back to the server. The other three are already holding
   * every job the business has.
   */
  const className = `tap-target grid h-11 w-11 place-items-center rounded-control ${
    accent
      ? "bg-brand text-on-brand"
      : "border border-line bg-white/[0.03] text-ink-muted active:bg-white/10"
  }`;

  if (view === "crew") {
    return (
      <Link href={scheduleHref(date, view)} aria-label={label} className={className}>
        {icon}
      </Link>
    );
  }

  return (
    <button type="button" onClick={() => onGo(date, view)} aria-label={label} className={className}>
      {icon}
    </button>
  );
}
