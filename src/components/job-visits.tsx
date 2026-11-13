"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarClock, ChevronDown, LoaderCircle } from "lucide-react";

import { endVisitForReturnAction, type JobActionState } from "@/app/jobs/[jobId]/actions";
import { DateTimeField, arrivalWindowEnd } from "@/components/ui/date-time-field";
import { Field, FormMessage, inputClass } from "@/components/ui/field";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}
      {pending ? "Submitting…" : "Submit return visit"}
    </button>
  );
}

/**
 * Ending today's visit with the job still open: what was done or what is
 * needed, and when to come back. The visit is kept in the job's history and
 * the job goes back to Scheduled (or waits for a time).
 */
export function EndVisitForReturn({
  jobNumber,
  timeZone,
  canText,
}: {
  jobNumber: string;
  timeZone: string;
  /** The customer can be texted about the new time. */
  canText: boolean;
}) {
  const [state, action] = useActionState<JobActionState, FormData>(endVisitForReturnAction, { error: "" });
  const [start, setStart] = useState("");

  if (state.notice) {
    return (
      <p className="text-sm leading-6 text-positive" role="status">
        {state.notice}
      </p>
    );
  }

  // Folded behind one line: most visits finish with Finish work, and the
  // return form is only for the ones that need another day.
  return (
    <details id="return-visit" className="group/return scroll-mt-24">
      <summary className="tap-target flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-control border border-line bg-raised px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5 text-sm">
          <CalendarClock className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <span className="font-semibold">Need to come back for more work? Tap to set up the next visit</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition group-open/return:rotate-180" aria-hidden />
      </summary>
    <form action={action} className="mt-3 space-y-3">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <p className="text-sm leading-6 text-ink-muted">
        This visit is saved to the job&apos;s history and the job is booked again. Nothing is invoiced or closed.
      </p>
      <Field label="What was done, and what the next visit is for">
        <textarea name="note" rows={3} maxLength={2000} className={inputClass} />
      </Field>
      <Field label="Return visit starts" hint="Leave blank to set the time later." group>
        <DateTimeField name="start" label="Return visit starts" timeZone={timeZone} onValueChange={setStart} />
      </Field>
      {start ? (
        <Field label="Arrival window ends" group>
          <DateTimeField name="end" label="Arrival window ends" timeZone={timeZone} defaultValue={arrivalWindowEnd(start)} windowFrom={start} />
        </Field>
      ) : null}
      {start && canText ? (
        <label className="flex min-h-11 items-center gap-2 text-sm">
          <input type="checkbox" name="notifyCustomer" defaultChecked className="h-5 w-5" />
          Text the customer the new time
        </label>
      ) : null}
      <FormMessage error={state.error} />
      <SaveButton />
    </form>
    </details>
  );
}
