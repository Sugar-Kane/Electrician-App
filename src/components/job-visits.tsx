"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { CalendarClock, LoaderCircle } from "lucide-react";

import { endVisitForReturnAction, type JobActionState } from "@/app/jobs/[jobId]/actions";
import { DateTimeField, arrivalWindowEnd } from "@/components/ui/date-time-field";
import { Field, FormMessage, inputClass } from "@/components/ui/field";

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-brand text-sm font-semibold text-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <CalendarClock className="h-4 w-4" aria-hidden />}
      End visit and book the return
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

  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <p className="text-sm leading-6 text-ink-muted">
        Need to come back (a part, or more time)? This visit is saved to the job&apos;s history and the job is booked
        again. Nothing is invoiced or closed.
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
  );
}
