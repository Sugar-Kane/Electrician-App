"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, CalendarPlus, Check, ClipboardCheck, Hammer, LoaderCircle, Receipt } from "lucide-react";

import { MaterialsForm, goTo } from "@/components/job-progress";
import { chooseDiagnosticOutcome, sendDiagnosticFeeInvoice } from "@/app/jobs/[jobId]/line-actions";
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
  scope: ["#parts-ready", "#work-materials", "#work"],
  quotes: ["#work-materials", "#work"],
  estimate: ["#estimate", "#contract", "#work-materials", "#work"],
  approval: ["#contract", "#work"],
  materials: ["#parts-ready", "#work-materials", "#work"],
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
              {step.fill !== undefined && step.fill > 0 && step.fill < 1 ? (
                // Part done: sent but not signed or paid, or materials listed
                // and priced but not picked up. That share of the bar filled.
                <span
                  className={`flex h-1.5 overflow-hidden rounded-full transition group-hover/step:opacity-80 ${
                    step.state === "current" ? "bg-brand/35" : "bg-line"
                  }`}
                  aria-hidden
                >
                  <span className="h-full bg-positive" style={{ width: `${Math.round(step.fill * 100)}%` }} />
                </span>
              ) : (
                <span
                  className={`block h-1.5 rounded-full transition group-hover/step:opacity-80 ${
                    step.state === "done" ? "bg-positive" : step.state === "current" ? "bg-brand" : "bg-line"
                  }`}
                  aria-hidden
                />
              )}
              <span
                className={`mt-1.5 flex items-start gap-0.5 text-[11px] font-semibold group-hover/step:underline sm:text-xs ${
                  step.state === "todo" ? "text-ink-muted" : ""
                }`}
              >
                {step.state === "done" ? <Check className="hidden h-3 w-3 shrink-0 text-positive sm:inline" aria-hidden /> : null}
                <span className="leading-tight [overflow-wrap:anywhere]">{step.label}</span>
              </span>
              <span className="sr-only">
                ,{" "}
                {step.fill !== undefined && step.fill > 0 && step.fill < 1
                  ? step.key === "invoice"
                    ? "sent, not paid yet"
                    : step.key === "approval"
                      ? "sent, not signed yet"
                      : step.fill > 0.5
                        ? "bought, not picked up yet"
                        : "listed, not bought yet"
                  : STATE_WORDS[step.state]}
                . Go to it.
              </span>
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
      ) : primary.kind === "fee_invoice" ? (
        <FeeInvoiceButton jobNumber={jobNumber} label={primary.label} />
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

/** Said under the choice once it is made. */
const CHOSEN_NOTES: Record<DiagnosticOutcome, string> = {
  diagnostic_only: "No repair. The diagnostic fee is the whole bill.",
  fix_now: "Repaired on this visit. The labor and parts are in Materials & labor.",
  schedule_later: "The repair is booked as its own work order, in Repair work orders.",
};

/**
 * What picking something else leaves behind. Nothing is removed by a change of
 * mind: a repair line or a booked work order is real work, so it is taken off
 * where it was put on, by hand.
 */
const CHANGE_NOTES: Record<DiagnosticOutcome, string> = {
  diagnostic_only: "",
  fix_now: "Picking something else keeps the repair lines; remove any that should not be billed in Materials & labor.",
  schedule_later: "Picking something else keeps the booked work order; cancel it from its own page if it is not happening.",
};

/** One tap: the diagnostic fee is put on an invoice and sent to the customer. */
function FeeInvoiceButton({ jobNumber, label }: { jobNumber: string; label: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ error: string; notice?: string } | null>(null);
  return (
    <div className="mt-4">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setResult(null);
          const outcome = await sendDiagnosticFeeInvoice(jobNumber);
          setResult(outcome);
          setBusy(false);
          router.refresh();
        }}
        className="tap-target inline-flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-base font-bold text-on-brand disabled:opacity-60"
      >
        {busy ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <Receipt className="h-5 w-5" aria-hidden />}
        {busy ? "Sending…" : label}
      </button>
      {result?.error ? (
        <p className="mt-2 text-sm text-critical" role="alert">
          {result.error}
        </p>
      ) : result?.notice ? (
        <p className="mt-2 text-sm text-positive" role="status">
          {result.notice}
        </p>
      ) : null}
    </div>
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
  embedded = false,
  chosen = null,
}: {
  jobNumber: string;
  /** Drawn inside another section (Diagnostic findings) rather than as its own card. */
  embedded?: boolean;
  /** The visit is already finished. */
  completed: boolean;
  /** "$180.00", or empty when the job has no fee. */
  feeLabel: string;
  /** The fee is still owed (not paid at booking). */
  feeDue: boolean;
  /**
   * What the job already shows was chosen (a repair on it, a work order
   * booked, or closed as diagnostic only). Shown as the answer, with a way to
   * change it, rather than the three choices again.
   */
  chosen?: DiagnosticOutcome | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<DiagnosticOutcome | null>(null);
  const [error, setError] = useState("");
  const [changing, setChanging] = useState(false);

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
    setChanging(false);
    if (outcome === "fix_now") {
      // The labor and parts go in just below; the visit is finished from the
      // yellow button once the repair is done.
      window.setTimeout(() => goTo("#work-materials"), 300);
    } else if (!completed) {
      // Diagnostic only: finish the visit. No scrolling: the visit card brings
      // its own question (parts used) into view if it has one, and otherwise
      // the page stays where Nick is.
      window.dispatchEvent(new Event("volteira:visit-advance"));
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

  const picked = chosen ? options.find((option) => option.outcome === chosen) ?? null : null;

  return (
    <section
      id="next-action"
      aria-labelledby="next-action-heading"
      className={
        embedded
          ? "scroll-mt-24 rounded-control border border-brand/40 bg-brand/[0.04] p-3"
          : "mb-3 scroll-mt-24 rounded-panel border border-brand/40 bg-surface p-4 sm:p-5"
      }
    >
      <h2 id="next-action-heading" className="flex items-center gap-2 text-sm font-semibold">
        <ClipboardCheck className="h-4 w-4 text-brand" aria-hidden />
        What did you find?
      </h2>
      {picked && !changing ? (
        <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
          <p className="flex min-w-0 items-start gap-3">
            <picked.icon className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <span>
              <span className="block text-sm font-semibold">{picked.title}</span>
              <span className="mt-0.5 block text-xs leading-5 text-ink-muted">{CHOSEN_NOTES[picked.outcome]}</span>
            </span>
          </p>
          <button
            type="button"
            onClick={() => setChanging(true)}
            className="tap-target inline-flex min-h-11 items-center rounded-control border border-line px-4 text-sm font-semibold"
          >
            Change
          </button>
        </div>
      ) : (
      <>
      {picked ? (
        <p className="mt-2 text-xs leading-5 text-ink-muted">
          Picked: {picked.title}. {CHANGE_NOTES[picked.outcome]}
        </p>
      ) : null}
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
      {picked ? (
        <button
          type="button"
          onClick={() => setChanging(false)}
          className="tap-target mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-ink-muted underline underline-offset-4"
        >
          Keep {picked.title.toLowerCase()}
        </button>
      ) : null}
      </>
      )}
      {error ? (
        <p className="mt-2 text-sm text-critical" role="alert">
          {error}
        </p>
      ) : null}
    </section>
  );
}
