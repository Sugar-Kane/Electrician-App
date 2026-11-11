"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarPlus, Check, ClipboardCheck, Hammer, LoaderCircle, Receipt } from "lucide-react";

import { MaterialsForm, goTo } from "@/components/job-progress";
import { chooseDiagnosticOutcome } from "@/app/jobs/[jobId]/line-actions";
import type { DiagnosticOutcome } from "@/lib/diagnostic-outcome";
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
              className="group/step flex h-full min-h-11 w-full flex-col justify-start rounded-chip pb-1 pt-0.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"
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
 * How a diagnostic visit ends, and the way to finish each.
 *
 * - Diagnostic only: no repair. The fee is put on the job if it is owed, and
 *   the visit is finished (or, already finished, the invoice is next).
 * - Fix it now: the repair is done on this visit, a store run included. The
 *   fee goes on the job and the labor and parts are added on top of it.
 * - Bigger job: booked as a linked work order for later; its invoice takes
 *   off the diagnostic fee the customer paid.
 *
 * The fee line is added on the server (chooseDiagnosticOutcome), once.
 */
export function DiagnosticDecision({
  jobNumber,
  completed,
  feeLabel,
  feeDue,
}: {
  jobNumber: string;
  /** The visit is already finished. */
  completed: boolean;
  /** "$180.00", or empty when the job has no fee. */
  feeLabel: string;
  /** The fee is still owed (not paid at booking). */
  feeDue: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<DiagnosticOutcome | null>(null);
  const [error, setError] = useState("");

  async function choose(outcome: DiagnosticOutcome) {
    setBusy(outcome);
    setError("");
    const result = await chooseDiagnosticOutcome(jobNumber, outcome);
    if (result.error) {
      setError(result.error);
      setBusy(null);
      return;
    }
    if (outcome === "schedule_later") {
      router.push(`/jobs/new?from=${jobNumber}&plan=return`);
      return;
    }
    router.refresh();
    setBusy(null);
    if (outcome === "fix_now") {
      // The labor and parts are added here; the visit is finished from the
      // yellow button once the repair is done.
      window.setTimeout(() => goTo("#work-materials"), 300);
    } else if (completed) {
      window.setTimeout(() => goTo("#billing"), 300);
    } else {
      // Finish the visit: the visit card asks about parts used, as always.
      window.dispatchEvent(new Event("volteira:visit-advance"));
      goTo("#work");
    }
  }

  const fee = feeLabel || "the diagnostic fee";
  const options: { outcome: DiagnosticOutcome; icon: typeof Hammer; title: string; note: string }[] = [
    {
      outcome: "diagnostic_only",
      icon: Receipt,
      title: "Diagnostic only",
      note: feeDue
        ? `No repair. Bill ${fee} for the diagnostic and close the job. No extra charge.`
        : "No repair, no extra charge. The diagnostic was paid when they booked.",
    },
    {
      outcome: "fix_now",
      icon: Hammer,
      title: "Fix it now",
      note: `Found the fix and doing it on this visit, even with a quick store run. Add the labor and parts; they are billed on top of ${fee}.`,
    },
    {
      outcome: "schedule_later",
      icon: CalendarPlus,
      title: "Bigger job: schedule it",
      note: `More than this visit. Book it as a work order for later${feeDue ? "" : `; the ${fee} they paid comes off its invoice`}.`,
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
        What did you find?
      </h2>
      <ul className="mt-3 grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <li key={option.outcome}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => choose(option.outcome)}
              className="tap-row flex min-h-16 w-full items-start gap-3 rounded-control border border-line px-3 py-3 text-left disabled:opacity-60"
            >
              {busy === option.outcome ? (
                <LoaderCircle className="mt-0.5 h-5 w-5 shrink-0 animate-spin text-brand" aria-hidden />
              ) : (
                <option.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              )}
              <span>
                <span className="block text-sm font-semibold">{option.title}</span>
                <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{option.note}</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {error ? (
        <p className="mt-2 text-sm text-critical" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
