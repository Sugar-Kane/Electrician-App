import Link from "next/link";
import {
  Banknote,
  CalendarClock,
  MessageSquareText,
  ShieldAlert,
  Wrench,
} from "lucide-react";

import { buildTimeline, type ActivityKind, type ActivityRow } from "@/lib/activity-timeline";

/**
 * What has happened to this customer, in the order it happened.
 *
 * The history existed as a table with three rows in it and nothing that read
 * them. This is the reading: one line per thing that happened, grouped by the
 * day it happened on, so the question "what did we tell them, and when" has an
 * answer that does not involve opening four screens and inferring it.
 *
 * Every entry is a fact the app recorded at the time. Nothing here is derived
 * from the current state of anything, which is the point — a job that is
 * finished today still shows the day somebody set off for it.
 */

const ICONS: Record<ActivityKind, typeof Wrench> = {
  inquiry: MessageSquareText,
  appointment: CalendarClock,
  money: Banknote,
  job: Wrench,
  safety: ShieldAlert,
  other: MessageSquareText,
};

const TONES: Record<ActivityKind, string> = {
  inquiry: "bg-info-bg text-info",
  appointment: "bg-brand/15 text-brand",
  money: "bg-positive-bg text-positive",
  job: "bg-white/5 text-ink-muted",
  safety: "bg-critical-bg text-critical",
  other: "bg-white/5 text-ink-muted",
};

export function ActivityTimeline({
  rows,
  timeZone,
  today,
  emptyText = "Nothing has happened yet.",
}: {
  rows: ActivityRow[];
  timeZone: string;
  /** Today where the business is, so "Today" means their today. */
  today: string;
  emptyText?: string;
}) {
  const days = buildTimeline(rows, timeZone, today);

  if (days.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-line p-4 text-center text-sm text-ink-muted">
        {emptyText}
      </p>
    );
  }

  const clock = (at: string) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(at));

  return (
    <div className="space-y-4">
      {days.map((day) => (
        <section key={day.date}>
          <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">
            {day.label}
          </h3>

          <ol className="mt-2 space-y-1.5">
            {day.entries.map((entry) => {
              const Icon = ICONS[entry.kind];

              const line = (
                <>
                  <span
                    className={`grid h-8 w-8 shrink-0 place-items-center rounded-chip ${TONES[entry.kind]}`}
                  >
                    <Icon className="h-4 w-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{entry.title}</span>
                    {entry.detail ? (
                      <span className="block text-xs text-ink-muted">{entry.detail}</span>
                    ) : null}
                  </span>
                  {/*
                    Right-aligned and tabular, so a column of times reads as a
                    column rather than as a ragged edge.
                  */}
                  <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">
                    {clock(entry.at)}
                  </span>
                </>
              );

              return (
                <li key={entry.id}>
                  {entry.jobId ? (
                    <Link
                      href={`/jobs/${entry.jobId}`}
                      className="tap-row flex min-h-11 items-center gap-2.5 rounded-control px-1 py-1.5 active:bg-white/5"
                    >
                      {line}
                    </Link>
                  ) : (
                    <div className="flex min-h-11 items-center gap-2.5 px-1 py-1.5">{line}</div>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
