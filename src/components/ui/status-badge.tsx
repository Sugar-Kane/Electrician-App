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

/**
 * The same vocabulary as a dot, for the week and month grids.
 *
 * Those grids carried their own map — bg-blue-400, bg-amber-400, bg-rose-400 —
 * which happened to be the exact hex values behind the tokens. So it looked
 * right and was one token edit away from not being: changing `--color-caution`
 * would move every badge in the app and leave the calendar dots behind.
 */
export function statusDot(status: string): string {
  switch (status) {
    case "In progress":
      return "bg-info";
    case "Completed":
      return "bg-positive";
    case "Canceled":
      return "bg-critical";
    case "Scheduled":
      return "bg-caution";
    default:
      return "bg-ink-muted";
  }
}

/**
 * The bordered variant, for the day list.
 *
 * A third copy of the same five statuses lived there as `statusStyles`, with
 * its own border and text weights. Same colours, same meanings, separately
 * maintained.
 */
export function statusChip(status: string): string {
  switch (status) {
    case "In progress":
      return "border-info/30 bg-info-bg text-info";
    case "Completed":
      return "border-positive/30 bg-positive-bg text-positive";
    case "Canceled":
      return "border-critical/30 bg-critical-bg text-critical";
    case "Scheduled":
      return "border-caution/30 bg-caution-bg text-caution";
    default:
      return "border-line bg-white/[0.06] text-ink-muted";
  }
}

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
      {status}
    </span>
  );
}
