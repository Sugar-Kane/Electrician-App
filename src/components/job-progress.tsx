"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowDown, Check, Circle, CircleDot, LoaderCircle, Minus, PackageCheck } from "lucide-react";

import { setMaterialsReady, type StepActionState } from "@/app/jobs/[jobId]/step-actions";
import type { ProgressKey, ProgressStep } from "@/lib/job-progress";

/**
 * Where the job is, in six steps, and what finishes the one you tap.
 *
 * The bar answers where the whole job stands: has it been priced, agreed,
 * gathered, worked, billed and paid. Tapping a step opens what finishes it, so
 * the next thing to do is a button rather than a section to go and find. Each
 * step's state is written out as well as drawn, never colour alone.
 */
const STATE_WORDS: Record<ProgressStep["state"], string> = {
  done: "done",
  current: "waiting",
  todo: "to do",
  skipped: "not needed",
};

function StepIcon({ state }: { state: ProgressStep["state"] }) {
  if (state === "done") return <Check className="h-3.5 w-3.5 text-positive" aria-hidden />;
  if (state === "current") return <CircleDot className="h-3.5 w-3.5 text-brand" aria-hidden />;
  if (state === "skipped") return <Minus className="h-3.5 w-3.5 text-ink-faint" aria-hidden />;
  return <Circle className="h-3.5 w-3.5 text-ink-faint" aria-hidden />;
}

/**
 * Go to a section of this page, opening it on the way if it is folded away.
 * A link to another page is left to the browser.
 */
function goTo(href: string, event: React.MouseEvent<HTMLAnchorElement>) {
  if (!href.startsWith("#")) return;
  const target = document.getElementById(href.slice(1));
  if (!target) return;
  event.preventDefault();
  let folded = target.closest("details");
  while (folded) {
    folded.open = true;
    folded = folded.parentElement?.closest("details") ?? null;
  }
  if (target instanceof HTMLDetailsElement) target.open = true;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  history.replaceState(null, "", href);
}

function ReadyButton({ ready }: { ready: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className={
        ready
          ? "tap-target inline-flex min-h-11 items-center text-sm font-semibold text-ink-muted disabled:opacity-60"
          : "tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60 sm:w-auto"
      }
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : ready ? null : <PackageCheck className="h-4 w-4" aria-hidden />}
      {ready ? "Mark not ready" : "Mark materials ready"}
    </button>
  );
}

function MaterialsForm({ jobNumber, ready }: { jobNumber: string; ready: boolean }) {
  const [state, action] = useActionState<StepActionState, FormData>(setMaterialsReady, { error: "" });
  return (
    <form action={action}>
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <input type="hidden" name="ready" value={ready ? "false" : "true"} />
      <ReadyButton ready={ready} />
      {state.error ? <p className="mt-1 text-xs text-critical">{state.error}</p> : null}
    </form>
  );
}

export function JobProgress({
  steps,
  next,
  jobNumber,
  initialStep,
  canUndoMaterials = false,
}: {
  steps: ProgressStep[];
  next: ProgressStep | null;
  jobNumber: string;
  /** From a job card: open on the step that was tapped there. */
  initialStep?: ProgressKey | null;
  /** Materials were marked ready by hand and the visit has not started. */
  canUndoMaterials?: boolean;
}) {
  const [selectedKey, setSelectedKey] = useState<ProgressKey | null>(initialStep ?? next?.key ?? null);
  const selected = steps.find((step) => step.key === selectedKey) ?? null;

  return (
    <section aria-labelledby="progress-heading" className="mb-3 rounded-panel border border-line bg-surface p-3 sm:p-4">
      <h2 id="progress-heading" className="sr-only">
        Where this job is
      </h2>
      {!next ? <p className="mb-2 text-sm font-semibold text-positive">Every step is done.</p> : null}

      {/* Columns sized in rem, so larger text means fewer, wider tiles rather
          than step names broken a letter at a time. */}
      <ol className="grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5">
        {steps.map((step) => {
          const isSelected = step.key === selectedKey;
          return (
            <li key={step.key}>
              <button
                type="button"
                aria-pressed={isSelected}
                aria-controls="step-panel"
                onClick={() => setSelectedKey(step.key)}
                className={`flex min-h-11 w-full flex-col justify-center rounded-chip border px-2 py-1 text-left ${
                  isSelected
                    ? "border-brand bg-brand/[0.10]"
                    : step === next
                      ? "border-brand/50 bg-brand/[0.04]"
                      : "border-line"
                }`}
              >
                <span className="flex items-center gap-1 text-xs font-semibold">
                  <StepIcon state={step.state} />
                  {step.label}
                </span>
                <span className="text-[11px] text-ink-faint">{STATE_WORDS[step.state]}</span>
              </button>
            </li>
          );
        })}
      </ol>

      {selected ? (
        <div id="step-panel" role="region" aria-label={`${selected.label} step`} className="mt-3 rounded-control border border-line bg-white/[0.02] p-3">
          <p className="text-sm">
            <span className="font-semibold">{selected.label}</span>
            <span className="text-ink-muted"> · {selected.note}</span>
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2">
            {selected.action?.kind === "materials_ready" ? (
              <MaterialsForm jobNumber={jobNumber} ready={false} />
            ) : selected.action?.kind === "go" ? (
              <a
                href={selected.action.href}
                onClick={(event) => goTo(selected.action?.kind === "go" ? selected.action.href : "", event)}
                className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand sm:w-auto"
              >
                {selected.action.label}
                <ArrowDown className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
            {selected.key === "materials" && selected.state === "done" && canUndoMaterials ? (
              <MaterialsForm jobNumber={jobNumber} ready />
            ) : null}
            {/* Every step can be looked at, finished or not. */}
            {selected.action?.kind !== "go" || selected.action.href !== selected.href ? (
              <a
                href={selected.href}
                onClick={(event) => goTo(selected.href, event)}
                className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand"
              >
                Go to {selected.label.toLowerCase()}
                <ArrowDown className="h-4 w-4" aria-hidden />
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}
