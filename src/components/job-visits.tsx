"use client";

import { useState } from "react";
import { ArrowRight, CalendarClock, ChevronDown } from "lucide-react";

import { DateTimeField, arrivalWindowEnd } from "@/components/ui/date-time-field";
import { Field, inputClass } from "@/components/ui/field";

/**
 * More work found at the end of a job: set up the follow-up as a new job.
 *
 * The next visit used to be booked onto this same job, so the extra work had
 * no estimate, contract or invoice of its own. Now this opens New job,
 * started from this job's customer and address, with what the next job is for
 * and when, as typed here. Nothing is saved until that form is. This job is
 * finished the usual way.
 */
export function EndVisitForReturn({
  jobNumber,
  timeZone,
}: {
  jobNumber: string;
  timeZone: string;
}) {
  const [start, setStart] = useState("");

  // Folded behind one line: most visits finish with Finish work, and this is
  // only for the ones that turn up more to do.
  return (
    <details id="return-visit" className="group/return scroll-mt-24">
      <summary className="tap-target flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-control border border-line bg-raised px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5 text-sm">
          <CalendarClock className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <span className="font-semibold">Need to come back for more work? Tap to set up a follow-up job</span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition group-open/return:rotate-180" aria-hidden />
      </summary>
      <form action="/jobs/new" method="get" className="mt-3 space-y-3">
        <input type="hidden" name="from" value={jobNumber} />
        <p className="text-sm leading-6 text-ink-muted">
          The follow-up is a new job with the same customer and address, and its own estimate, contract and invoice.
          Finish this job as usual.
        </p>
        <Field label="What the follow-up job is for">
          <textarea name="next" rows={3} maxLength={2000} className={inputClass} />
        </Field>
        <Field label="Follow-up starts" hint="Leave blank to set the time later." group>
          <DateTimeField name="start" label="Follow-up starts" timeZone={timeZone} onValueChange={setStart} />
        </Field>
        {start ? (
          <Field label="Arrival window ends" group>
            <DateTimeField name="end" label="Arrival window ends" timeZone={timeZone} defaultValue={arrivalWindowEnd(start)} windowFrom={start} />
          </Field>
        ) : null}
        <button
          type="submit"
          className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand text-sm font-semibold text-on-brand"
        >
          Set up follow-up job
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </details>
  );
}
