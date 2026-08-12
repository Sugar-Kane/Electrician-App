"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { Check, CircleDot, LoaderCircle, Navigation, Wrench } from "lucide-react";

import { updateJob, type JobActionState } from "@/app/jobs/[jobId]/actions";

/**
 * The four states a technician changes during a job, as four taps.
 *
 * These already existed in the database and in the edit form — as options in a
 * dropdown, inside a collapsed panel, below the fold. So the states that change
 * hourly cost more taps than the ones that change never, and two of them
 * (en route, arrived) rendered as "In progress" everywhere else, which made
 * them invisible after being set.
 *
 * Setting a status sends nothing to the customer. Telling them is a separate
 * decision with its own button, and a status tap that quietly texted somebody
 * would be a surprise nobody asked for.
 */

const STEPS = [
  { value: "en_route", label: "On my way", icon: Navigation },
  { value: "arrived", label: "Arrived", icon: CircleDot },
  { value: "in_progress", label: "Working", icon: Wrench },
  { value: "completed", label: "Complete", icon: Check },
] as const;

const initialState: JobActionState = { error: "" };

function StepButton({
  step,
  current,
}: {
  step: (typeof STEPS)[number];
  current: string;
}) {
  const { pending } = useFormStatus();
  const active = current === step.value;
  const Icon = step.icon;

  return (
    <button
      type="submit"
      name="status"
      value={step.value}
      disabled={pending}
      aria-pressed={active}
      className={`tap-target flex min-h-16 flex-1 flex-col items-center justify-center gap-1 rounded-control border text-xs font-semibold disabled:opacity-60 ${
        active ? "border-brand bg-brand text-on-brand" : "border-line bg-surface text-ink-muted"
      }`}
    >
      {pending && active ? (
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <Icon className="h-5 w-5" aria-hidden />
      )}
      {step.label}
    </button>
  );
}

export function JobStatusStrip({
  jobNumber,
  status,
  canceled,
}: {
  jobNumber: string;
  status: string;
  canceled: boolean;
}) {
  const [state, action] = useActionState(updateJob, initialState);

  // A canceled job has no next state, and offering "On my way" on one is how
  // somebody drives to a job that is not happening.
  if (canceled) return null;

  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="jobNumber" value={jobNumber} />

      <div className="flex gap-2">
        {STEPS.map((step) => (
          <StepButton key={step.value} step={step} current={status} />
        ))}
      </div>

      {state.error ? <p className="text-xs text-critical">{state.error}</p> : null}
      {state.notice ? <p className="text-xs text-positive">{state.notice}</p> : null}
    </form>
  );
}
