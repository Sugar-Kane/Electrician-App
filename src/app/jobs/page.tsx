import Link from "next/link";
import { CalendarDays, ChevronRight, MapPin, Plus, Search } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { SpanishBadge } from "@/components/language-badge";
import { RevealCurrent } from "@/components/ui/reveal-current";
import { followUps, isPastVisit } from "@/lib/follow-ups";
import { getAgreementStates, getJobs } from "@/lib/job-data";
import {
  JOB_STAGE_FILTERS,
  JOB_STAGE_LABELS,
  isJobStageFilter,
  jobStage,
  startTimePassed,
  type JobStage,
} from "@/lib/job-stage";
import type { PilotJob } from "@/lib/pilot-data";
import { currentContext } from "@/lib/request-context";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

export const dynamic = "force-dynamic";

/**
 * Every job, by where it stands.
 *
 * The schedule only ever showed jobs with a time, by day, so a quote waiting
 * on a customer or last month's finished job could only be found through
 * search. This is the list of all of them. The filter and the search box live
 * in the address, so opening a job and coming back lands on the same list.
 */

const ORDER: JobStage[] = [
  "in_progress",
  "needs_estimate",
  "awaiting_approval",
  "to_schedule",
  "scheduled",
  "completed",
  "canceled",
];

const STAGE_STYLES: Record<JobStage, string> = {
  needs_estimate: "bg-caution-bg text-caution",
  awaiting_approval: "bg-brand/10 text-brand",
  to_schedule: "bg-caution-bg text-caution",
  scheduled: "bg-white/5 text-ink",
  in_progress: "bg-positive-bg text-positive",
  completed: "bg-positive-bg text-positive",
  canceled: "bg-white/5 text-ink-faint",
};

type Row = { job: PilotJob; stage: JobStage; passed: boolean; toConfirm: boolean };

const TIME_PASSED = "time_passed";

function sortRows(rows: Row[]): Row[] {
  return [...rows].sort((a, b) => {
    const byStage = ORDER.indexOf(a.stage) - ORDER.indexOf(b.stage);
    if (byStage !== 0) return byStage;
    const at = a.job.startsAt ?? "";
    const bt = b.job.startsAt ?? "";
    // Upcoming work soonest first, then visits whose time went by without
    // being started; finished work most recent first; the rest newest first.
    if (a.stage === "scheduled") {
      if (a.passed !== b.passed) return a.passed ? 1 : -1;
      return a.passed ? bt.localeCompare(at) : at.localeCompare(bt);
    }
    if (a.stage === "in_progress") return at.localeCompare(bt);
    if (a.stage === "completed" || a.stage === "canceled") return bt.localeCompare(at);
    return Number(b.job.id) - Number(a.job.id);
  });
}

function matches(job: PilotJob, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const digits = needle.replace(/\D+/g, "");
  if (digits.length >= 3 && job.phone.replace(/\D+/g, "").includes(digits)) return true;
  return [job.customer, job.address, job.city, job.summary, job.workType, `#${job.id}`, job.id]
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

function filterHref(stage: string, query: string): string {
  const params = new URLSearchParams();
  if (stage !== "all") params.set("stage", stage);
  if (query) params.set("q", query);
  const search = params.toString();
  return search ? `/jobs?${search}` : "/jobs";
}

export default async function JobsPage({
  searchParams,
}: {
  searchParams: Promise<{ stage?: string; q?: string }>;
}) {
  const [{ stage: askedStage = "", q = "" }, { jobs }, agreements, context] = await Promise.all([
    searchParams,
    getJobs(),
    getAgreementStates(),
    currentContext(),
  ]);
  // "Time passed" is not a stage but a check across them: the visits Today asks
  // to confirm, worked out the same way, so its count matches Today's.
  const pastVisits = new Set(
    followUps({ jobs, unbilled: {}, now: new Date(), timeZone: context?.timeZone || DEFAULT_TIMEZONE })
      .filter(isPastVisit)
      .map((item) => item.jobNumber),
  );
  const stage: JobStage | "all" | typeof TIME_PASSED =
    askedStage === TIME_PASSED ? TIME_PASSED : isJobStageFilter(askedStage) ? askedStage : "all";
  const query = q.slice(0, 80);

  const rows: Row[] = jobs.map((job) => ({
    job,
    stage: jobStage({
      status: job.status,
      scheduled: Boolean(job.startsAt),
      kindOfWork: job.kindOfWork,
      agreement: agreements[job.id] ?? null,
    }),
    passed: startTimePassed(job.startsAt),
    toConfirm: pastVisits.has(job.id),
  }));
  const searched = rows.filter((row) => matches(row.job, query));
  const counts = new Map<string, number>();
  for (const row of searched) counts.set(row.stage, (counts.get(row.stage) ?? 0) + 1);
  const toConfirm = searched.filter((row) => row.toConfirm);
  const shown = sortRows(
    stage === "all"
      ? searched
      : stage === TIME_PASSED
        ? toConfirm
        : searched.filter((row) => row.stage === stage),
  );

  // Shown only while there is something in it, or it is the filter in use.
  const filters = [
    ...JOB_STAGE_FILTERS,
    ...(toConfirm.length > 0 || stage === TIME_PASSED ? [{ value: TIME_PASSED, label: "Time passed" }] : []),
  ];
  const label = filters.find((filter) => filter.value === stage)?.label ?? "All";

  return (
    <FieldPageShell
      title="Jobs"
      eyebrow="Work"
      compact
      action={
        <div className="flex items-center gap-2">
          <Link
            href="/schedule"
            className="tap-target inline-flex min-w-11 items-center justify-center gap-2 rounded-control border border-line px-3 text-sm font-semibold"
          >
            <CalendarDays className="h-4 w-4" aria-hidden />
            {/* Icon only on the narrowest phones, so the title keeps its line. */}
            <span className="max-[399px]:sr-only">Calendar</span>
          </Link>
          {/* Desktop has New job in its top bar on every screen. */}
          <Link
            href="/jobs/new"
            className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-3 text-sm font-semibold text-on-brand lg:hidden"
          >
            <Plus className="h-4 w-4" aria-hidden />
            New job
          </Link>
        </div>
      }
    >
      <section className="rounded-panel border border-line bg-surface p-3 sm:p-5">
        <form action="/jobs" className="flex gap-2">
          {stage !== "all" ? <input type="hidden" name="stage" value={stage} /> : null}
          <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-raised px-4">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <span className="sr-only">Search jobs</span>
            <input
              name="q"
              defaultValue={query}
              placeholder="Customer, address or job number"
              className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint"
            />
          </label>
          <button className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">
            Search
          </button>
        </form>

        {/*
          Scrolls sideways inside itself on a phone rather than wrapping into
          three ragged rows; the page itself never scrolls sideways.
        */}
        <nav
          id="job-filters"
          aria-label="Filter jobs by stage"
          className="-mx-3 mt-3 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {filters.map((filter) => {
            const active = filter.value === stage;
            const count =
              filter.value === "all"
                ? searched.length
                : filter.value === TIME_PASSED
                  ? toConfirm.length
                  : (counts.get(filter.value) ?? 0);
            return (
              <Link
                key={filter.value}
                href={filterHref(filter.value, query)}
                aria-current={active ? "page" : undefined}
                className={`tap-target inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-chip px-3 text-xs font-semibold ${
                  active ? "bg-brand text-on-brand" : "border border-line text-ink-muted hover:text-ink"
                }`}
              >
                {filter.label}
                <span className={active ? "text-on-brand/80" : "text-ink-faint"}>{count}</span>
              </Link>
            );
          })}
        </nav>
        <RevealCurrent targetId="job-filters" />

        <h2 className="sr-only">
          {label}
          {query ? ` matching ${query}` : ""}
        </h2>

        {shown.length === 0 ? (
          <p className="mt-4 rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            {query
              ? `No ${stage === "all" ? "" : `${label.toLowerCase()} `}jobs match “${query}”.`
              : stage === "all"
                ? "No jobs yet. New job adds the first one."
                : stage === TIME_PASSED
                  ? "No visits to confirm. Every past visit says what happened."
                  : `No jobs are ${label.toLowerCase()} right now.`}
          </p>
        ) : (
          <>
          {stage === TIME_PASSED ? (
            <p className="mt-3 text-sm text-ink-muted">
              Their time has gone by and the job doesn&apos;t say what happened. Open each one to start, reschedule or
              complete it.
            </p>
          ) : null}
          <ul className="mt-3 space-y-2">
            {shown.map(({ job, stage: rowStage, passed }) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.id}`}
                  prefetch={false}
                  className="tap-row flex min-h-16 items-center gap-3 rounded-control border border-line bg-raised px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline justify-between gap-2">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <span className="min-w-0 truncate text-sm font-semibold">{job.customer}</span>
                        <SpanishBadge language={job.customerLanguage} />
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${STAGE_STYLES[rowStage]}`}
                      >
                        {JOB_STAGE_LABELS[rowStage]}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      #{job.id} · {job.kindOfWork}
                      {job.summary ? ` · ${job.summary}` : ""}
                    </span>
                    <span className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 text-xs text-ink-faint">
                      <span>
                        {job.startsAt ? `${job.dateLabel} · ${job.time}` : "No time yet"}
                        {passed && rowStage === "scheduled" ? (
                          <span className="text-caution"> · date passed</span>
                        ) : null}
                      </span>
                      {job.address || job.city ? (
                        <span className="flex min-w-0 items-center gap-1">
                          <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                          <span className="truncate">{[job.address, job.city].filter(Boolean).join(", ")}</span>
                        </span>
                      ) : null}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
          </>
        )}
      </section>
    </FieldPageShell>
  );
}
