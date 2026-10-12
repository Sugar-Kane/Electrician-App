import { Check, ChevronRight, Circle, CircleDot, Minus } from "lucide-react";

import type { ProgressStep } from "@/lib/job-progress";

/**
 * Where the job is, in six steps, with the next one first.
 *
 * The job page answers what to do on this visit; this answers where the whole
 * job stands — has it been priced, agreed, worked, billed and paid — so the
 * next thing to do is named rather than found by opening every section. Each
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

export function JobProgress({ steps, next }: { steps: ProgressStep[]; next: ProgressStep | null }) {
  return (
    <section aria-labelledby="progress-heading" className="mb-3 rounded-panel border border-line bg-surface p-3 sm:p-4">
      <h2 id="progress-heading" className="sr-only">
        Where this job is
      </h2>
      {next ? (
        <a
          href={next.href}
          className="tap-row -m-1 flex min-h-11 items-center gap-2 rounded-control p-1"
        >
          <span className="min-w-0 flex-1 text-sm">
            <span className="font-semibold text-brand">Next: {next.label}</span>
            <span className="text-ink-muted"> · {next.note}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
        </a>
      ) : (
        <p className="text-sm font-semibold text-positive">Every step is done.</p>
      )}
      {/* Columns sized in rem, so larger text means fewer, wider tiles rather
          than step names broken a letter at a time. */}
      <ol className="mt-2 grid grid-cols-[repeat(auto-fit,minmax(5.5rem,1fr))] gap-1.5">
        {steps.map((step) => (
          <li key={step.key}>
            <a
              href={step.href}
              title={step.note}
              className={`flex min-h-11 flex-col justify-center rounded-chip border px-2 py-1 ${
                step === next ? "border-brand/50 bg-brand/[0.06]" : "border-line"
              }`}
            >
              <span className="flex items-center gap-1 text-xs font-semibold">
                <StepIcon state={step.state} />
                {step.label}
              </span>
              <span className="text-[11px] text-ink-faint">{STATE_WORDS[step.state]}</span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}
