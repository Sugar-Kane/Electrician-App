import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Hourglass,
  MapPin,
  Navigation,
  Phone,
  Plus,
  Receipt,
} from "lucide-react";

import { AssignTechnician } from "@/components/assign-technician";
import { JobSource } from "@/components/ui/job-source";
import { statusTone } from "@/components/ui/status-badge";
import { needsTechnician, type AttentionItem } from "@/lib/dashboard-focus";
import { lateLabel, type FollowUp, type FollowUpKind, type Lateness } from "@/lib/follow-ups";
import type { PilotJob } from "@/lib/pilot-data";

/**
 * The working day, at the top of the screen.
 *
 * The dashboard opened with five metric cards and reached the schedule in the
 * third section. An electrician opening this in a truck wants one thing —
 * where am I going, and how do I get there — and everything else can wait until
 * they have scrolled for it.
 */

/** Directions, without asking which app. Google handles both platforms. */
function directionsHref(job: PilotJob): string {
  const destination = [job.address, job.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}`;
}

export function NextJobCard({
  job,
  isToday,
  late,
}: {
  job: PilotJob;
  isToday: boolean;
  /** Set when its time has gone by without it being started or finished. */
  late?: Lateness;
}) {
  const address = [job.address, job.city].filter(Boolean).join(", ");
  const status = late ? lateLabel(late) : job.status;

  return (
    <section
      aria-labelledby="next-job-heading"
      className="rounded-panel border border-brand/30 bg-brand/[0.06] p-4 sm:p-5"
    >
      <div className="flex items-start justify-between gap-3">
        <p
          id="next-job-heading"
          className="text-xs font-semibold uppercase tracking-[0.14em] text-brand"
        >
          {job.status === "In progress" ? "On this job" : isToday ? "Next job" : "Next job up"}
          {` · ${job.kindOfWork}`}
        </p>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
          {status}
        </span>
      </div>

      <p className="mt-3 text-lg font-semibold leading-tight">
        {isToday ? job.time : `${job.dateLabel} · ${job.time}`} · {job.customer}
      </p>

      {job.summary ? (
        <p className="mt-1 text-sm leading-6 text-ink-muted">{job.summary}</p>
      ) : null}

      {address ? (
        <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-muted">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {address}
        </p>
      ) : null}

      <div className="mt-4 grid gap-2 sm:grid-cols-3">
        {address ? (
          <a
            href={directionsHref(job)}
            target="_blank"
            rel="noreferrer"
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand text-sm font-semibold text-on-brand"
          >
            <Navigation className="h-4 w-4" aria-hidden />
            Navigate
          </a>
        ) : null}

        {job.phone ? (
          <a
            href={`tel:${job.phone.replace(/[^\d+]/g, "")}`}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
          >
            <Phone className="h-4 w-4" aria-hidden />
            Call
          </a>
        ) : null}

        <Link
          href={`/jobs/${job.id}`}
          className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
        >
          Open job
        </Link>
      </div>
    </section>
  );
}

export function TodaysJobs({
  jobs,
  canceledCount,
  late = {},
}: {
  jobs: PilotJob[];
  canceledCount: number;
  /** Today's jobs whose time has gone by untouched, by job number. */
  late?: Record<string, Lateness>;
}) {
  const statusOf = (job: PilotJob) => (late[job.id] ? lateLabel(late[job.id]!) : job.status);

  return (
    <section aria-labelledby="today-heading" className="mt-3">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 id="today-heading" className="text-sm font-semibold">
          Jobs today
        </h2>
        <span className="text-xs text-ink-muted">
          {jobs.length === 0 ? "None" : `${jobs.length} active`}
          {/* Canceled work is named but never added in — a day that looks full
              because of a cancellation is a day somebody plans around wrongly. */}
          {canceledCount > 0 ? ` · ${canceledCount} canceled` : ""}
        </span>
      </div>

      {jobs.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-6 text-center">
          <p className="text-sm text-ink-muted">Nothing booked today.</p>
          <div className="mt-3 flex flex-wrap justify-center gap-2">
            <Link
              href="/jobs/new"
              className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
            >
              <Plus className="h-4 w-4" aria-hidden />
              New job
            </Link>
            <Link
              href="/booking-requests"
              className="tap-target inline-flex items-center rounded-control border border-line px-4 text-sm font-semibold"
            >
              Booking requests
            </Link>
          </div>
        </div>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => (
            /*
              The row is a link and the assign control is a button, so they are
              siblings rather than nested — a button inside an anchor is invalid
              markup, and in practice the tap lands on whichever the browser
              feels like.
            */
            <li
              key={job.id}
              className="tap-row flex min-h-16 items-center gap-2 rounded-control border border-line bg-surface pr-3 active:bg-raised"
            >
              <Link href={`/jobs/${job.id}`} className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-4">
                <span className="w-16 shrink-0">
                  <span className="block text-sm font-semibold text-brand">{job.time}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint">{job.endTime}</span>
                </span>
                <span className="min-w-0 flex-1 border-l border-line pl-3">
                  <span className="block truncate text-sm font-semibold">{job.customer}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="min-w-0 truncate">
                      {/* Which of the two visits it is, rather than what it
                          is about. On a booked job the category is the fault,
                          so this read "EV charger" and never said whether the
                          two hours at the house were to find it or to fix it. */}
                      <span className="font-medium text-ink">{job.kindOfWork}</span>
                      {job.city ? ` · ${job.city}` : ""}
                    </span>
                    {/* Secondary metadata, and kept off the narrowest screens
                        where the customer and the time are what matter.
                        `max-sm:hidden` rather than `hidden sm:inline-flex`:
                        JobSource is `inline-flex` itself, and that won over
                        `hidden`, so on a phone the tag stayed and squeezed the
                        kind of work down to "Diagno…". */}
                    <JobSource channel={job.channel} className="shrink-0 max-sm:hidden" />
                  </span>
                </span>
                {/*
                  One trailing element, never two. A status pill and an assign
                  control side by side left about ninety pixels for the customer
                  at 390px, which rendered "Coastal Dental" as "C.".
                */}
                {needsTechnician(job) ? null : (
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone(statusOf(job))}`}
                  >
                    {statusOf(job)}
                  </span>
                )}
              </Link>

              {/*
                Exactly where the row would otherwise say "Unassigned", and
                nowhere else. A job with somebody on it needs no dispatching,
                and reassigning is a job-page decision rather than something to
                crowd a list with.
              */}
              {needsTechnician(job) ? (
                <AssignTechnician jobNumber={job.id} technician={job.technician} size="sm" />
              ) : (
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

const FOLLOW_UP_LOOK: Record<FollowUpKind, { icon: typeof Clock3; row: string; iconTone: string }> = {
  not_finished: { icon: Hourglass, row: "border-critical/30 bg-critical-bg", iconTone: "text-critical" },
  not_started: { icon: Clock3, row: "border-critical/30 bg-critical-bg", iconTone: "text-critical" },
  to_complete: { icon: CheckCircle2, row: "border-line bg-surface", iconTone: "text-info" },
  not_invoiced: { icon: Receipt, row: "border-line bg-surface", iconTone: "text-brand" },
};

/** How many show before the rest fold away. */
const FOLLOW_UPS_SHOWN = 6;

function FollowUpRow({ item }: { item: FollowUp }) {
  const look = FOLLOW_UP_LOOK[item.kind];
  const Icon = look.icon;
  return (
    <li>
      <Link
        href={`/jobs/${item.jobNumber}`}
        className={`tap-row flex min-h-13 items-center gap-3 rounded-control border px-4 py-3 ${look.row}`}
      >
        <Icon className={`h-4 w-4 shrink-0 ${look.iconTone}`} aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">
            {item.customer} · #{item.jobNumber}
          </span>
          {/* First, and where Jobs today says it: a missed diagnostic is a
              visit to rebook, a work order left open is a crew to chase. */}
          <span className="mt-0.5 block text-xs text-ink-muted">
            {item.kindOfWork ? (
              <>
                <span className="font-medium text-ink">{item.kindOfWork}</span>
                {" · "}
              </>
            ) : null}
            {item.detail}
          </span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
      </Link>
    </li>
  );
}

/**
 * The loose ends: visits nobody started, work left open, work done and not
 * signed off, and finished work nobody has billed.
 *
 * Each row is the job it is about, because every way of clearing one — starting
 * it, finishing it, rescheduling, canceling, invoicing — is on the job. It is
 * there all day, and it is what is left when the day is over. Nothing at all
 * when there is nothing to follow up, like Needs attention.
 */
export function FollowUps({ items }: { items: FollowUp[] }) {
  if (items.length === 0) return null;

  const shown = items.slice(0, FOLLOW_UPS_SHOWN);
  const folded = items.slice(FOLLOW_UPS_SHOWN);

  return (
    <section aria-labelledby="follow-up-heading" className="mt-3">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 id="follow-up-heading" className="text-sm font-semibold">
          To follow up
        </h2>
        <span className="text-xs text-ink-muted">{items.length}</span>
      </div>
      <ul className="space-y-2">
        {shown.map((item) => (
          <FollowUpRow key={`${item.kind}-${item.jobNumber}`} item={item} />
        ))}
      </ul>
      {folded.length > 0 ? (
        <details className="group mt-2">
          <summary className="tap-target flex min-h-11 cursor-pointer list-none items-center px-1 text-sm font-semibold text-brand [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show {folded.length} more</span>
            <span className="hidden group-open:inline">Show fewer</span>
          </summary>
          <ul className="mt-2 space-y-2">
            {folded.map((item) => (
              <FollowUpRow key={`${item.kind}-${item.jobNumber}`} item={item} />
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );
}

/**
 * The things that need somebody.
 *
 * Renders nothing at all when the list is empty rather than an empty card. A
 * panel that says "nothing to report" teaches people to skip the place real
 * warnings appear.
 */
export function NeedsAttention({ items }: { items: AttentionItem[] }) {
  if (items.length === 0) return null;

  return (
    <section aria-labelledby="attention-heading" className="mt-3">
      <h2 id="attention-heading" className="mb-2 px-1 text-sm font-semibold">
        Needs attention
      </h2>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.href + item.label}>
            <Link
              href={item.href}
              className={`tap-row flex min-h-13 items-center gap-3 rounded-control border px-4 py-3 ${
                item.urgent ? "border-caution/30 bg-caution-bg" : "border-line bg-surface"
              }`}
            >
              {item.urgent ? (
                <AlertTriangle className="h-4 w-4 shrink-0 text-caution" aria-hidden />
              ) : null}
              <span
                className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                  item.urgent ? "text-caution" : ""
                }`}
              >
                {item.label}
              </span>
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
