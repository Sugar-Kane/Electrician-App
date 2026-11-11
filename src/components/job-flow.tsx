"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarPlus, Check, ClipboardCheck, FileText, Hammer, LoaderCircle, Receipt } from "lucide-react";

import { MaterialsForm, goTo } from "@/components/job-progress";
import type { FlowStage, StageKey } from "@/lib/job-flow";

/**
 * Where the job is in its own flow, and the one thing to do next.
 *
 * A segment for every stage of the kind of job (seven for a diagnostic, nine
 * for a work order), the status in words, and a single primary action. When the visit
 * card's own button is the action (Start trip, Begin work), this card says so
 * and draws no second button: one primary per screen.
 *
 * Each step's state is written out as well as drawn, never colour alone.
 */
const STATE_WORDS = { done: "done", current: "now", todo: "to do" } as const;

/*
 * Where each stage is done on the job page, best first. A section that is not
 * on the page for this job (no visit under way yet, nothing billed) falls
 * through to the next, and the visit card, which is always there, is last.
 */
const STEP_TARGETS: Record<StageKey, string[]> = {
  intake: ["#request", "#work"],
  schedule: ["#visits", "#work"],
  travel: ["#work"],
  diagnose: ["#findings", "#work"],
  decide: ["#next-action", "#repairs", "#work"],
  scope: ["#work-materials", "#work"],
  quotes: ["#work-materials", "#work"],
  estimate: ["#contract", "#work-materials", "#work"],
  approval: ["#contract", "#work"],
  materials: ["#work-materials", "#work"],
  work: ["#findings", "#work"],
  invoice: ["#billing", "#work-materials", "#work"],
  paid: ["#billing", "#work-materials", "#work"],
};

function goToFirst(targets: string[]) {
  const found = targets.find((href) => document.getElementById(href.slice(1)));
  if (found) goTo(found);
}

export function JobStageCard({
  stage,
  jobNumber,
  canEndVisit = false,
}: {
  stage: FlowStage;
  jobNumber: string;
  /** On site with the job open: the visit can end with a return booked. */
  canEndVisit?: boolean;
}) {
  const { primary } = stage;
  const current = stage.steps.find((step) => step.state === "current");

  // A visit step is carried out by the visit card (job-workflow.tsx), so the
  // button asks it to, and shows its progress while it saves.
  const [visitPending, setVisitPending] = useState(false);
  useEffect(() => {
    const handle = (event: Event) => setVisitPending(Boolean((event as CustomEvent<boolean>).detail));
    window.addEventListener("volteira:visit-pending", handle);
    return () => window.removeEventListener("volteira:visit-pending", handle);
  }, []);

  return (
    <section id="job-stage" aria-labelledby="stage-heading" className="mb-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 id="stage-heading" className="text-sm font-semibold text-ink-muted">
          Job progress
        </h2>
        <p className="text-sm font-semibold" aria-live="polite">
          <span className="sr-only">Status: </span>
          {stage.status}
        </p>
      </div>

      {/* One segment per stage, each a way to its section of the page. Two
          rows on a phone so every name stays readable, one line from tablet
          width up. */}
      <ol
        className={`mt-3 grid gap-x-1.5 gap-y-2 ${
          stage.steps.length > 7 ? "grid-cols-5 sm:grid-cols-9" : "grid-cols-4 sm:grid-cols-7"
        }`}
        aria-label={`Step ${current ? stage.steps.indexOf(current) + 1 : stage.steps.length} of ${stage.steps.length}`}
      >
        {stage.steps.map((step) => (
          <li key={step.key} aria-current={step.state === "current" ? "step" : undefined}>
            <button
              type="button"
              onClick={() => goToFirst(STEP_TARGETS[step.key])}
              className="group/step block min-h-11 w-full rounded-chip pb-1 pt-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
            >
              <span
                className={`block h-1.5 rounded-full transition group-hover/step:opacity-80 ${
                  step.state === "done" ? "bg-positive" : step.state === "current" ? "bg-brand" : "bg-line"
                }`}
                aria-hidden
              />
              <span
                className={`mt-1.5 flex items-start gap-0.5 text-[11px] font-semibold group-hover/step:underline sm:text-xs ${
                  step.state === "todo" ? "text-ink-muted" : ""
                }`}
              >
                {step.state === "done" ? <Check className="hidden h-3 w-3 shrink-0 text-positive sm:inline" aria-hidden /> : null}
                <span className="leading-tight [overflow-wrap:anywhere]">{step.label}</span>
              </span>
              <span className="sr-only">, {STATE_WORDS[step.state]}. Go to it.</span>
            </button>
          </li>
        ))}
      </ol>

      {primary.kind === "go" ? (
        <a
          href={primary.href}
          onClick={(event) => goTo(primary.href, event)}
          className="tap-target mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand"
        >
          {primary.label}
          <ArrowRight className="h-5 w-5" aria-hidden />
        </a>
      ) : primary.kind === "materials_ready" ? (
        <div className="mt-4 [&_button]:min-h-14 [&_button]:w-full [&_button]:text-base">
          <MaterialsForm jobNumber={jobNumber} ready={false} />
        </div>
      ) : primary.kind === "visit" ? (
        <button
          type="button"
          disabled={visitPending}
          onClick={() => {
            window.dispatchEvent(new Event("volteira:visit-advance"));
            goTo(primary.href);
          }}
          className="tap-target mt-4 inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand disabled:opacity-60"
        >
          {visitPending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
          {primary.label}
          {visitPending ? null : <ArrowRight className="h-5 w-5" aria-hidden />}
        </button>
      ) : (
        <p className="mt-3 flex items-center gap-1.5 text-sm font-semibold text-positive">
          <Check className="h-4 w-4" aria-hidden />
          {primary.label}
        </p>
      )}

      {stage.hint ? <p className="mt-2 text-sm leading-6 text-ink-muted">{stage.hint}</p> : null}
      {canEndVisit ? (
        <a
          href="#visits"
          onClick={(event) => goTo("#visits", event)}
          className="tap-target mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-ink-muted underline underline-offset-4"
        >
          Need to come back another day?
        </a>
      ) : null}
    </section>
  );
}

/**
 * What to do about what a diagnostic found.
 *
 * Four answers, each a real path. Every repair is its own work order, linked
 * back to this visit so the history and the diagnostic credit carry over; this
 * job is never turned into the repair. Billing the diagnostic alone is the
 * fourth, and goes to this job's invoice.
 */
export function DiagnosticDecision({ jobNumber, creditLabel }: { jobNumber: string; creditLabel: string }) {
  const book = `/jobs/new?from=${jobNumber}`;
  const options = [
    {
      href: `${book}&plan=now`,
      icon: Hammer,
      title: "Repair now",
      note: "A linked work order booked for right now, to do on this visit once the customer approves the price.",
    },
    {
      href: `${book}&plan=estimate`,
      icon: FileText,
      title: "Create repair estimate",
      note: "A linked work order to price and send for approval. No time set yet.",
    },
    {
      href: `${book}&plan=return`,
      icon: CalendarPlus,
      title: "Schedule return visit",
      note: "A linked work order with its own arrival window, for when parts or time are needed.",
    },
    {
      href: "#billing",
      icon: Receipt,
      title: "Finish diagnostic only",
      note: "No repair. Bill the diagnostic fee and close the job.",
    },
  ];

  return (
    <section
      id="next-action"
      aria-labelledby="next-action-heading"
      className="mb-3 scroll-mt-24 rounded-panel border border-brand/40 bg-surface p-4 sm:p-5"
    >
      <h2 id="next-action-heading" className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden />
        What happens next?
      </h2>
      {creditLabel ? (
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          The {creditLabel} paid for this diagnostic comes off a repair&apos;s invoice.
        </p>
      ) : null}
      <ul className="mt-3 grid gap-2 sm:grid-cols-2">
        {options.map((option) => (
          <li key={option.title}>
            {option.href.startsWith("#") ? (
              <a
                href={option.href}
                onClick={(event) => goTo(option.href, event)}
                className="tap-row flex min-h-16 items-start gap-3 rounded-control border border-line px-3 py-3"
              >
                <option.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{option.note}</span>
                </span>
              </a>
            ) : (
              <Link
                href={option.href}
                className="tap-row flex min-h-16 items-start gap-3 rounded-control border border-line px-3 py-3"
              >
                <option.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{option.title}</span>
                  <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{option.note}</span>
                </span>
              </Link>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
