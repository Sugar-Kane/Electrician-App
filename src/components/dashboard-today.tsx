import Link from "next/link";
import {
  AlertTriangle,
  ChevronRight,
  MapPin,
  Navigation,
  Phone,
  Plus,
} from "lucide-react";

import { JobSource } from "@/components/ui/job-source";
import { statusTone } from "@/components/ui/status-badge";
import type { AttentionItem } from "@/lib/dashboard-focus";
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

export function NextJobCard({ job, isToday }: { job: PilotJob; isToday: boolean }) {
  const address = [job.address, job.city].filter(Boolean).join(", ");

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
        </p>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(job.status)}`}>
          {job.status}
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
}: {
  jobs: PilotJob[];
  canceledCount: number;
}) {
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
            <li key={job.id}>
              <Link
                href={`/jobs/${job.id}`}
                className="tap-row flex min-h-16 items-center gap-3 rounded-control border border-line bg-surface px-4 py-3 active:bg-raised"
              >
                <span className="w-16 shrink-0">
                  <span className="block text-sm font-semibold text-brand">{job.time}</span>
                  <span className="mt-0.5 block text-xs text-ink-faint">{job.endTime}</span>
                </span>
                <span className="min-w-0 flex-1 border-l border-line pl-3">
                  <span className="block truncate text-sm font-semibold">{job.customer}</span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-ink-muted">
                    <span className="min-w-0 truncate">
                      {job.workType}
                      {job.city ? ` · ${job.city}` : ""}
                    </span>
                    {/* Secondary metadata, and kept off the narrowest screens
                        where the customer and the time are what matter. */}
                    <JobSource channel={job.channel} className="hidden shrink-0 sm:inline-flex" />
                  </span>
                </span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${statusTone(job.status)}`}
                >
                  {job.status}
                </span>
                <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
              </Link>
            </li>
          ))}
        </ul>
      )}
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
