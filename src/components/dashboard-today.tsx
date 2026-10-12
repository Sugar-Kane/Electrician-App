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
import type { MoneySummary as Money } from "@/lib/dashboard";
import { needsTechnician, type AttentionItem, type AttentionKey } from "@/lib/dashboard-focus";
import { formatMoney, revenueDetail } from "@/lib/dashboard-metrics";
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
        <span className={`shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] font-semibold ${statusTone(status)}`}>
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

      {/* "Assign N jobs today" points here, so the next job, which the list
          below leaves out, has its own way to send somebody. */}
      {needsTechnician(job) ? (
        <div className="mt-3 flex items-center justify-between gap-3 border-t border-line pt-3">
          <p className="text-sm text-ink-muted">Nobody is on this job yet.</p>
          <AssignTechnician jobNumber={job.id} technician={job.technician} size="sm" />
        </div>
      ) : null}
    </section>
  );
}

export function TodaysJobs({
  jobs,
  canceledCount,
  doneCount = 0,
  nextIsToday = false,
  late = {},
}: {
  /** Today's visits still to do, after the next job shown above. */
  jobs: PilotJob[];
  canceledCount: number;
  /** Today's visits already finished. */
  doneCount?: number;
  /** Whether the next job card above is one of today's. */
  nextIsToday?: boolean;
  /** Today's jobs whose time has gone by untouched, by job number. */
  late?: Record<string, Lateness>;
}) {
  const statusOf = (job: PilotJob) => (late[job.id] ? lateLabel(late[job.id]!) : job.status);
  const tally = [
    jobs.length === 0 ? "" : `${jobs.length} to go`,
    doneCount > 0 ? `${doneCount} done` : "",
    // Canceled work is named but never added in — a day that looks full
    // because of a cancellation is a day somebody plans around wrongly.
    canceledCount > 0 ? `${canceledCount} canceled` : "",
  ].filter(Boolean);

  return (
    <section aria-labelledby="today-heading" className="mt-5">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 id="today-heading" className="text-sm font-semibold">
          {nextIsToday ? "Rest of today" : "Today's visits"}
        </h2>
        {tally.length > 0 ? <span className="text-xs text-ink-muted">{tally.join(" · ")}</span> : null}
      </div>

      {jobs.length === 0 && nextIsToday ? (
        <p className="rounded-panel border border-dashed border-line px-4 py-3 text-sm text-ink-muted">
          Nothing else booked today.
        </p>
      ) : jobs.length === 0 ? (
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
 * What needs somebody, as a list of things to do.
 *
 * Each task says what to do and how many ("Confirm 7 past visits"), why it is
 * here, and opens the list of exactly those. The past visits and the finished
 * work to bill also open in place, one row per job, because each is cleared on
 * its job.
 *
 * Most urgent first: the ones that cost a customer or money if left carry a
 * warning icon as well as their colour.
 */
export function NeedsYourAction({
  items,
  details = {},
}: {
  items: AttentionItem[];
  /** The jobs behind a task, for those that open in place. */
  details?: Partial<Record<AttentionKey, FollowUp[]>>;
}) {
  return (
    <section aria-labelledby="action-heading" className="mt-5">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 id="action-heading" className="text-sm font-semibold">
          Needs your action
        </h2>
        {items.length > 0 ? <span className="text-xs text-ink-muted">{items.length}</span> : null}
      </div>

      {items.length === 0 ? (
        <p className="flex items-center gap-2 rounded-panel border border-line bg-surface px-4 py-3 text-sm text-ink-muted">
          <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
          Nothing needs you right now.
        </p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <ActionRow key={item.key} item={item} rows={details[item.key] ?? []} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ActionRow({ item, rows }: { item: AttentionItem; rows: FollowUp[] }) {
  const tone = item.urgent ? "border-caution/30 bg-caution-bg" : "border-line bg-surface";
  const heading = (
    <>
      {item.urgent ? (
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
      ) : (
        <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-ink-faint" aria-hidden />
      )}
      <span className="min-w-0 flex-1">
        <span className={`block text-sm font-semibold ${item.urgent ? "text-caution" : ""}`}>
          {item.urgent ? <span className="sr-only">Urgent: </span> : null}
          {item.label}
        </span>
        <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{item.reason}</span>
      </span>
    </>
  );

  // One job behind it: straight to that job.
  const href = item.href ?? (rows.length === 1 ? `/jobs/${rows[0]!.jobNumber}` : undefined);

  return (
    <li className={`rounded-control border ${tone}`}>
      {href ? (
        <Link href={href} className="tap-row flex min-h-13 items-start gap-3 px-4 py-3">
          {heading}
          <ChevronRight className="h-5 w-5 shrink-0 self-center text-ink-faint" aria-hidden />
        </Link>
      ) : (
        <div className="flex min-h-13 items-start gap-3 px-4 py-3">{heading}</div>
      )}

      {rows.length > 1 ? (
        <details className="group border-t border-line/70 px-2 pb-2">
          <summary className="tap-target flex min-h-11 cursor-pointer list-none items-center px-2 text-sm font-semibold text-brand [&::-webkit-details-marker]:hidden">
            <span className="group-open:hidden">Show the {rows.length}</span>
            <span className="hidden group-open:inline">Hide them</span>
          </summary>
          <ul className="space-y-2">
            {rows.map((row) => (
              <FollowUpRow key={`${row.kind}-${row.jobNumber}`} item={row} />
            ))}
          </ul>
        </details>
      ) : null}
    </li>
  );
}

/**
 * The money, in four lines, each opening the list that makes up its number.
 *
 * Detailed reporting is a tap away; Today only answers "has anything come in,
 * and what is still out".
 */
export function MoneySummary({ money }: { money: Money }) {
  const revenue = revenueDetail({ todayCents: money.paidTodayCents, yesterdayCents: money.paidYesterdayCents });
  const lines: { label: string; value: string; detail: string; href: string; danger?: boolean }[] = [
    {
      label: "Paid today",
      value: formatMoney(money.paidTodayCents),
      detail: revenue.detail,
      href: "/invoices?status=paid&paid=today",
    },
    {
      label: "Owed to you",
      value: formatMoney(money.owedCents),
      detail:
        money.overdueCount > 0
          ? `${money.overdueCount} overdue · ${formatMoney(money.overdueCents)}`
          : money.owedCents > 0
            ? "None overdue"
            : "Nothing outstanding",
      href: "/invoices?status=awaiting",
      danger: money.overdueCount > 0,
    },
    {
      label: "Drafts not sent",
      value: formatMoney(money.draftCents),
      detail:
        money.draftCount === 0
          ? "None waiting"
          : `${money.draftCount} ${money.draftCount === 1 ? "invoice" : "invoices"}, not owed until sent`,
      href: "/invoices?status=draft",
    },
    {
      label: "Awaiting approval",
      value: money.awaitingApprovalCents > 0 ? formatMoney(money.awaitingApprovalCents) : String(money.awaitingApprovalCount),
      detail:
        money.awaitingApprovalCount === 0
          ? "No estimates out"
          : `${money.awaitingApprovalCount} ${money.awaitingApprovalCount === 1 ? "estimate" : "estimates"} sent to sign`,
      href: "/jobs?stage=awaiting_approval",
    },
  ];

  return (
    <section aria-labelledby="money-heading" className="mt-5">
      <div className="mb-2 flex items-end justify-between px-1">
        <h2 id="money-heading" className="text-sm font-semibold">
          Money
        </h2>
        <Link
          href="/reports"
          className="tap-target -my-2 inline-flex min-h-11 items-center px-2 text-xs font-semibold text-brand"
        >
          Reports
        </Link>
      </div>
      <ul className="grid gap-px overflow-hidden rounded-panel border border-line bg-line sm:grid-cols-2 lg:grid-cols-4">
        {lines.map((line) => (
          <li key={line.label} className="bg-surface">
            <Link
              href={line.href}
              className="tap-row flex min-h-16 items-center gap-3 px-4 py-3"
              aria-label={`${line.label}: ${line.value}. ${line.detail}. Open the list`}
            >
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-semibold text-ink-muted">{line.label}</span>
                <span className="mt-0.5 block text-lg font-semibold leading-tight">{line.value}</span>
                <span className={`mt-0.5 block text-xs ${line.danger ? "text-critical" : "text-ink-muted"}`}>
                  {line.detail}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
