/**
 * One vocabulary of job status, and one set of colours for it.
 *
 * The same five statuses were styled in four places — the schedule, the crew
 * page, the dashboard and the job card — with different palettes, so "Scheduled"
 * was amber on one screen and yellow on another. A status people scan for has
 * to look the same everywhere or it is not being scanned.
 */
export function statusTone(status: string): string {
  switch (status) {
    case "In progress":
      return "bg-info-bg text-info";
    case "Completed":
      return "bg-positive-bg text-positive";
    case "Canceled":
      return "bg-critical-bg text-critical";
    case "Scheduled":
      return "bg-caution-bg text-caution";
    default:
      // Pending and anything unrecognised. Deliberately quiet: an unknown
      // status shouting for attention is worse than one that waits to be read.
      return "bg-white/[0.06] text-ink-muted";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
      {status}
    </span>
  );
}
