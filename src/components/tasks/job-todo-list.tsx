import Link from "next/link";
import { AlertTriangle, Briefcase, CalendarClock, ChevronRight } from "lucide-react";

import type { DayJob } from "@/lib/job-todos";
import type { NeedsAction } from "@/lib/needs-action";

/**
 * The home screen's "Needs your action", shown on the Tasks page beside the
 * tasks people wrote: the same list (needs-action.ts), the same words, the
 * same links. Doing the thing on the job clears it in both places.
 */
export function JobTodoList({ jobs, items, dateLabel }: { jobs: DayJob[]; items: NeedsAction["items"]; dateLabel: string }) {
  if (jobs.length === 0 && items.length === 0) return null;
  return (
    <section aria-labelledby="job-todos-heading" className="rounded-panel border border-line bg-surface p-3">
      <h2 id="job-todos-heading" className="mb-2 inline-flex items-center gap-2 text-sm font-semibold text-ink">
        <Briefcase className="h-4 w-4 text-brand" aria-hidden />
        Needs your action{items.length ? ` · ${items.length}` : ""}
      </h2>
      {items.length > 0 ? (
        <ul className="mb-3 grid gap-1.5">
          {items.map((item) => (
            <li key={item.key} className={`rounded-control border px-3 py-2 text-sm ${item.urgent ? "border-caution/50 bg-caution-bg/30" : "border-line"}`}>
              <Link href={item.href && !item.href.startsWith("#") ? item.href : "/"} className="flex items-start gap-2 hover:underline">
                {item.urgent ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden /> : null}
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold text-ink">{item.label}</span>
                  <span className="block text-xs text-ink-muted">{item.reason}</span>
                </span>
                <ChevronRight className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              </Link>
              {item.details.length > 0 ? (
                <ul className="mt-1.5 grid gap-1 pl-6">
                  {item.details.slice(0, 8).map((detail) => (
                    <li key={detail.href + detail.label}>
                      <Link href={detail.href} className="text-xs text-ink-muted hover:text-ink hover:underline">
                        {detail.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      {jobs.length > 0 ? (
        <>
          <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-faint">{dateLabel}</p>
          <ul className="grid gap-1.5">
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
    </section>
  );
}
