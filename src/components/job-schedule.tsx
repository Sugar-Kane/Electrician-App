"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CalendarClock, CheckCircle2 } from "lucide-react";

import { updateJob, type JobActionState } from "@/app/jobs/[jobId]/actions";
import { SubmitButton } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Field, FormMessage } from "@/components/ui/field";

/**
 * The visit's time, set on the job page itself.
 *
 * Folded to one line once a time is saved, open while there is none. Anything
 * pointing at `#schedule` (the progress card's Schedule visit, the visits
 * list's Change time, a link from Today) opens it.
 *
 * Saving sends only the window: the status follows on the server (a time
 * schedules a job that was not), and the status itself stays on Job settings.
 */

const initialState: JobActionState = { error: "" };

export function JobSchedule({
  jobNumber,
  startLocal,
  endLocal,
  timeZone,
  label,
  reachable,
}: {
  jobNumber: string;
  /** Wall-clock values in the business's zone, `YYYY-MM-DDTHH:mm`, or "". */
  startLocal: string;
  endLocal: string;
  timeZone: string;
  /** The saved window in words, e.g. "Fri, Nov 13 · 10:00 AM–12:00 PM"; "" when none. */
  label: string;
  /** How the customer can be told: "text", "email". */
  reachable: string[];
}) {
  const [state, action] = useActionState(updateJob, initialState);
  const [windowStart, setWindowStart] = useState(startLocal);
  const fold = useRef<HTMLDetailsElement>(null);

  // Folded once a save goes through.
  useEffect(() => {
    if (state.notice && !state.error && fold.current) fold.current.open = false;
  }, [state]);

  // Opened by a link to it, from this page or another.
  useEffect(() => {
    const openIfAsked = () => {
      if (window.location.hash === "#schedule" && fold.current) {
        fold.current.open = true;
        fold.current.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    };
    openIfAsked();
    window.addEventListener("hashchange", openIfAsked);
    return () => window.removeEventListener("hashchange", openIfAsked);
  }, []);

  const saved = state.notice && !state.error;

  return (
    <div className="mt-1">
      <details id="schedule" ref={fold} open={!label} className="group scroll-mt-24">
        <summary className="tap-target flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
          <span className="flex min-w-0 items-center gap-2 text-sm text-ink-muted">
            <CalendarClock className="h-4 w-4 shrink-0" aria-hidden />
            <span className={label ? "" : "font-semibold text-ink"}>{label || "No time set"}</span>
          </span>
          <span className="shrink-0 text-sm font-semibold text-brand">
            <span className="group-open:hidden">{label ? "Change" : "Set time"}</span>
            <span className="hidden group-open:inline">Close</span>
          </span>
        </summary>

        <form action={action} className="mt-3 rounded-control border border-line bg-raised p-4">
          <input type="hidden" name="jobNumber" value={jobNumber} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Arrival window starts" group>
              <DateTimeField
                name="start"
                defaultValue={startLocal}
                label="Arrival window starts"
                timeZone={timeZone}
                onValueChange={setWindowStart}
              />
            </Field>
            <Field label="Arrival window ends" group>
              <DateTimeField
                name="end"
                defaultValue={endLocal}
                label="Arrival window ends"
                timeZone={timeZone}
                windowFrom={windowStart}
              />
            </Field>
          </div>

          <label className="mt-4 flex min-h-12 cursor-pointer items-center gap-3">
            <input type="checkbox" name="notifyCustomer" defaultChecked className="h-5 w-5 shrink-0 accent-[color:var(--color-brand)]" />
            <span className="text-sm">
              Tell the customer if the time changes
              <span className="mt-0.5 block text-xs text-ink-muted">
                {reachable.length > 0 ? `Sent by ${reachable.join(" and ")}.` : "No phone or email on file, so nothing can be sent."}
              </span>
            </span>
          </label>

          {state.error ? <FormMessage error={state.error} /> : null}

          <div className="mt-4">
            <SubmitButton pendingLabel="Saving…">Save time</SubmitButton>
          </div>
        </form>
      </details>

      {saved ? (
        <p className="mt-1 flex items-start gap-2 text-sm text-positive" role="status">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{state.notice}</span>
        </p>
      ) : null}
    </div>
  );
}
