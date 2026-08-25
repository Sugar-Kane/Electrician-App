import Link from "next/link";
import { CalendarOff, Store, TriangleAlert, UserRound } from "lucide-react";

import { statusDot } from "@/components/ui/status-badge";
import type { CalendarDay } from "@/lib/calendar";
import type { CrewDay, CrewReason, CrewSlot } from "@/lib/crew-week";
import { friendlyTime } from "@/lib/electrician-hours";
import type { PilotJob } from "@/lib/pilot-data";

/**
 * The whole crew's week, in one look.
 *
 * Hours are set one person at a time, and until this existed they could only be
 * read back one person at a time: "Nick works Monday and Tuesday" lived on
 * Nick's card and "Sam works Wednesdays" on Sam's, so the question an owner
 * actually asks — who is working Wednesday, and what is already booked into it
 * — had no screen at all.
 *
 * The hours shown are the ones a customer could book: clamped to the shop's own
 * hours, with a note when that clamping did something, because a row reading
 * "6am–8pm" over a shop that opens at eight is a promise the booking page will
 * not keep.
 *
 * Same seven-card shape as the jobs week view, so the two tabs read as one
 * calendar rather than two products.
 */

const REASONS: Record<CrewReason, string> = {
  closed: "closed",
  roster: "not working",
  unscheduled: "not scheduled",
  timeOff: "time off",
  outside: "hours outside the shop's",
};

/** Canceled work is not work. It stays visible and never inflates a count. */
function countable(jobs: PilotJob[]): PilotJob[] {
  return jobs.filter((job) => job.status !== "Canceled");
}

function JobLine({ job }: { job: PilotJob }) {
  return (
    <Link
      href={`/jobs/${job.id}`}
      className={`tap-target flex min-h-11 items-center gap-1.5 rounded-chip px-1.5 active:bg-white/5 ${
        job.status === "Canceled" ? "opacity-55" : ""
      }`}
    >
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(job.status)}`} aria-hidden />
      <span className="shrink-0 text-[11px] font-semibold">{job.time}</span>
      <span
        className={`min-w-0 flex-1 truncate text-[11px] text-ink-muted ${
          job.status === "Canceled" ? "line-through" : ""
        }`}
      >
        {job.customer}
      </span>
    </Link>
  );
}

function WorkingRow({ slot, jobs }: { slot: CrewSlot; jobs: PilotJob[] }) {
  if (!slot.window) return null;

  return (
    <li className="rounded-control border border-line bg-white/[0.02] p-2">
      <div className="flex items-center gap-2">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-chip bg-brand/15 text-[10px] font-bold text-brand">
          {slot.initials || <UserRound className="h-3.5 w-3.5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{slot.name}</span>
          <span className="flex items-center gap-1 text-[11px] text-ink-muted">
            {/*
              The dated dot, the same mark the hours calendar uses for a day set
              on its own, so the two screens agree about what that means.
            */}
            {slot.dated ? (
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand" aria-hidden />
            ) : null}
            {friendlyTime(slot.window.start)}–{friendlyTime(slot.window.end)}
            {slot.dated ? <span className="sr-only">, set for this day only</span> : null}
          </span>
        </span>
      </div>

      {slot.trimmed ? (
        <p className="mt-1 text-[10px] leading-4 text-ink-faint">
          Trimmed to the shop&apos;s hours.
        </p>
      ) : null}

      {slot.timeOff ? (
        <p className="mt-1 flex items-start gap-1 text-[10px] leading-4 text-caution">
          <CalendarOff className="mt-px h-3 w-3 shrink-0" aria-hidden />
          Some of this day is booked off · {slot.timeOff}
        </p>
      ) : null}

      {jobs.length > 0 ? <div className="mt-1 space-y-0.5">{jobs.map((job) => <JobLine key={job.id} job={job} />)}</div> : null}
    </li>
  );
}

export function CrewWeekView({
  days,
  crew,
  jobs,
}: {
  /** The labels and the today marker, from the same helper the week view uses. */
  days: CalendarDay[];
  /** One entry per date in `days`, already resolved by `crewWeek`. */
  crew: CrewDay[];
  jobs: PilotJob[];
}) {
  const byDate = new Map(crew.map((day) => [day.date, day]));

  return (
    <div className="grid gap-2 lg:grid-cols-7">
      {days.map((day) => {
        const resolved = byDate.get(day.date);
        const working = resolved?.slots.filter((slot) => slot.window !== null) ?? [];
        const off = resolved?.slots.filter((slot) => slot.window === null) ?? [];

        const dayJobs = jobs.filter((job) => job.date === day.date);
        // Anything booked onto somebody who is not working that day, or onto
        // nobody at all. This is the mismatch the screen exists to catch, so it
        // is listed rather than quietly dropped.
        const stray = dayJobs.filter(
          (job) => !working.some((slot) => slot.name && slot.name === job.technician),
        );

        return (
          <section
            key={day.date}
            className={`rounded-control border p-3 ${
              day.isToday ? "border-brand/50 bg-brand/[0.05]" : "border-line bg-surface"
            }`}
          >
            <header className="flex items-center justify-between gap-2">
              <Link
                href={`/schedule?date=${day.date}`}
                /*
                 * A minimum width as well as a height. This was 44px tall and
                 * as wide as its words, so "Fri 4" came out 35px across — the
                 * first nine days of every month were a target too small to
                 * hit, and the current week hid it because two-digit dates are
                 * wider.
                 */
                className="tap-target inline-flex min-h-11 min-w-11 items-center text-sm font-semibold hover:text-brand"
              >
                {day.weekday} {day.day}
              </Link>
              <span className="shrink-0 text-[10px] text-ink-faint">
                {resolved?.open ? `${working.length || "Nobody"} working` : "Closed"}
              </span>
            </header>

            {/*
              Only when there is something the header has not already said. A
              day the usual week shuts needs no second sentence; a day shut by a
              closure somebody booked should name it.
            */}
            {resolved && !resolved.open && resolved.closure ? (
              <p className="flex items-start gap-1.5 rounded-chip border border-dashed border-line px-2 py-2 text-[11px] leading-4 text-ink-faint">
                <Store className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{resolved.closure}</span>
              </p>
            ) : null}

            {working.length > 0 ? (
              <ul className="mt-2 space-y-1.5">
                {working.map((slot) => (
                  <WorkingRow
                    key={slot.id}
                    slot={slot}
                    jobs={dayJobs.filter((job) => job.technician === slot.name)}
                  />
                ))}
              </ul>
            ) : null}

            {/*
              Said plainly, because a day with nobody on it offers customers no
              appointments at all and looks exactly like a quiet day otherwise.
            */}
            {resolved?.open && working.length === 0 ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-chip bg-caution-bg px-2 py-2 text-[11px] leading-4 text-caution">
                <TriangleAlert className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                Nobody is working, so nothing can be booked.
              </p>
            ) : null}

            {stray.length > 0 ? (
              <div className="mt-2 border-t border-line pt-2">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">
                  Also booked
                </p>
                <div className="mt-1 space-y-0.5">
                  {stray.map((job) => (
                    <div key={job.id}>
                      <JobLine job={job} />
                      <p className="px-1.5 text-[10px] leading-4 text-ink-faint">
                        {job.technician ? `${job.technician} is not working` : "Nobody assigned"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {/*
              One muted line rather than a row each. Who is off is worth knowing
              and not worth a third of the card.
            */}
            {resolved?.open && off.length > 0 ? (
              <p className="mt-2 text-[10px] leading-4 text-ink-faint">
                Off:{" "}
                {off
                  .map(
                    (slot) =>
                      `${slot.name} (${slot.reason ? REASONS[slot.reason] : "not working"}${
                        slot.timeOff ? `, ${slot.timeOff}` : ""
                      })`,
                  )
                  .join(" · ")}
              </p>
            ) : null}

            {countable(dayJobs).length === 0 && working.length > 0 ? (
              <p className="mt-2 rounded-chip border border-dashed border-line px-2 py-2 text-center text-[10px] text-ink-faint">
                No jobs booked
              </p>
            ) : null}
          </section>
        );
      })}
    </div>
  );
}
