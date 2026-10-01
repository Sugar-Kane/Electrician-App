import Link from "next/link";
import { ChevronRight, Plus, Wrench } from "lucide-react";

import { statusTone } from "@/components/ui/status-badge";
import { formatCents } from "@/lib/job-lines";
import type { LinkedJob } from "@/lib/job-data";

/**
 * What a diagnostic found, booked.
 *
 * A diagnostic is two hours to find the fault. When the fix is another visit,
 * it is its own job — a work order — and this is where it is booked from:
 * New job, started as the same customer and address, linked back here so the
 * fee the customer paid for this visit comes off the repair's invoice.
 *
 * Once something is booked it is listed here, so this page is not a dead end
 * for somebody asking what happened about what was found.
 */
export function JobFollowUps({
  jobNumber,
  booked,
  creditCents,
}: {
  jobNumber: string;
  booked: LinkedJob[];
  /** What the next work order booked from this diagnostic would take off. */
  creditCents: number;
}) {
  const href = `/jobs/new?from=${jobNumber}`;

  return (
    <section
      aria-labelledby="follow-up-work-heading"
      className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5"
    >
      <h2 id="follow-up-work-heading" className="text-sm font-semibold">
        Work order
      </h2>

      {booked.length === 0 ? (
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          Found work that needs another visit? Book it as a work order.
          {creditCents > 0
            ? ` The ${formatCents(creditCents)} paid for this diagnostic comes off its invoice.`
            : ""}
        </p>
      ) : (
        <ul className="mt-2 space-y-2">
          {booked.map((job) => (
            <li key={job.jobNumber}>
              <Link
                href={`/jobs/${job.jobNumber}`}
                className="tap-row flex min-h-13 items-center gap-3 rounded-control border border-line px-3 py-2.5"
              >
                <Wrench className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {job.kindOfWork} #{job.jobNumber}
                  </span>
                  <span className="mt-0.5 block text-xs text-ink-muted">
                    {job.when || "Not scheduled yet"}
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

      {/* The first one is the point of the card; another is the exception. */}
      <Link
        href={href}
        className={`tap-target mt-3 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border text-sm font-semibold ${
          booked.length === 0 ? "border-brand text-brand" : "border-line text-ink"
        }`}
      >
        <Plus className="h-4 w-4" aria-hidden />
        {booked.length === 0 ? "Book work order" : "Book another work order"}
      </Link>
    </section>
  );
}
