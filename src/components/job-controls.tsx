"use client";

import { useActionState, useState } from "react";
import { CalendarClock, Ban, X } from "lucide-react";

import { cancelJob, updateJob, type JobActionState } from "@/app/jobs/[jobId]/actions";
import { Button, SubmitButton } from "@/components/ui/button";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Field, FormMessage, TextInput } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";

/**
 * Moving a job, and calling it off.
 *
 * Cancelling is kept behind a second step rather than put beside Save. It ends
 * somebody's appointment and sends them a text saying so, and neither is
 * undoable — a mis-tap should not be able to do it.
 *
 * The status dropdown is the manual override, and it is now the only one: the
 * field screen advances a job one step at a time through a state machine that
 * refuses to skip. This is where somebody in the office puts a job back after
 * it went the wrong way, or marks the customer a no-show — both real, neither
 * worth a button on a screen used from a driveway.
 */

const initialState: JobActionState = { error: "" };

const STATUS_OPTIONS = [
  { value: "confirmed", label: "Confirmed" },
  { value: "assigned", label: "Assigned" },
  { value: "en_route", label: "On the way" },
  { value: "arrived", label: "Arrived" },
  { value: "in_progress", label: "In progress" },
  { value: "completed", label: "Completed" },
  { value: "no_show", label: "Customer no-show" },
];

export function JobControls({
  jobNumber,
  status,
  startLocal,
  endLocal,
  timeZone,
  canceled,
  cancellationReason,
  customerPhone,
  customerEmail,
}: {
  jobNumber: string;
  status: string;
  /** Wall-clock values for the inputs, already in the business's zone. */
  startLocal: string;
  endLocal: string;
  /** The zone those wall-clock values belong to, so the calendar rings today. */
  timeZone: string;
  canceled: boolean;
  cancellationReason: string;
  customerPhone: string;
  customerEmail: string;
}) {
  const [editState, editAction] = useActionState(updateJob, initialState);
  const [cancelState, cancelAction] = useActionState(cancelJob, initialState);
  const [confirming, setConfirming] = useState(false);

  const reachable = [customerPhone ? "text" : "", customerEmail ? "email" : ""].filter(Boolean);

  if (canceled) {
    return (
      <section className="rounded-panel border border-critical/30 bg-critical-bg p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <Ban className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden />
          <div>
            <h2 className="text-lg font-semibold text-ink">This job is canceled</h2>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              {cancellationReason || "No reason was recorded."}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              A canceled job cannot be edited. Book a new visit instead, so the customer gets a
              fresh confirmation.
            </p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      <form action={editAction}>
        <section id="window" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-chip bg-brand/10 text-brand">
              <CalendarClock className="h-5 w-5" aria-hidden />
            </span>
            <div>
              <h2 className="text-lg font-semibold tracking-tight">Edit this job</h2>
              <p className="text-sm text-ink-muted">Times are in the business&rsquo;s timezone.</p>
            </div>
          </div>

          <input type="hidden" name="jobNumber" value={jobNumber} />

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Field label="Arrival window starts" group>
              <DateTimeField
                name="start"
                defaultValue={startLocal}
                label="Arrival window starts"
                timeZone={timeZone}
              />
            </Field>
            <Field label="Arrival window ends" group>
              <DateTimeField
                name="end"
                defaultValue={endLocal}
                label="Arrival window ends"
                timeZone={timeZone}
              />
            </Field>
          </div>

          <div className="mt-4">
            <Field label="Status">
              <SelectField name="status" defaultValue={status} label="Status" choices={STATUS_OPTIONS} />
            </Field>
          </div>

          <label className="mt-4 flex min-h-14 cursor-pointer items-center gap-3 rounded-control border border-line bg-raised px-4">
            <input
              type="checkbox"
              name="notifyCustomer"
              defaultChecked
              className="h-5 w-5 shrink-0 accent-[color:var(--color-brand)]"
            />
            <span className="text-sm">
              Tell the customer if the time changes
              <span className="mt-0.5 block text-xs text-ink-muted">
                {reachable.length > 0
                  ? `Sent by ${reachable.join(" and ")}. Nothing is sent for other edits.`
                  : "No phone or email on file, so nothing can be sent."}
              </span>
            </span>
          </label>

          <FormMessage error={editState.error} notice={editState.notice} />

          <div className="mt-5">
            <SubmitButton pendingLabel="Saving…">Save changes</SubmitButton>
          </div>
        </section>
      </form>

      <section id="cancel" className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold tracking-tight">Cancel this job</h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          The customer is told straight away, so they are not waiting at home for somebody who is
          not coming.
        </p>

        {confirming ? (
          <form action={cancelAction} className="mt-5">
            <input type="hidden" name="jobNumber" value={jobNumber} />

            <Field
              label="Reason (optional)"
              hint="Sent to the customer word for word. Leave it blank to say only that the visit is canceled."
            >
              <TextInput
                name="reason"
                maxLength={500}
                placeholder="Our van broke down and we cannot reach you today."
              />
            </Field>

            <p className="mt-4 rounded-control border border-critical/30 bg-critical-bg p-4 text-sm leading-6 text-ink">
              {reachable.length > 0 ? (
                <>
                  This cancels the visit and immediately sends a{" "}
                  <strong>{reachable.join(" and ")}</strong> to the customer. It cannot be undone.
                </>
              ) : (
                <>
                  This customer has no phone number or email on file, so{" "}
                  <strong>nobody will be told</strong>. You will need to call them yourself.
                </>
              )}
            </p>

            <FormMessage error={cancelState.error} notice={cancelState.notice} />

            <div className="mt-5 flex flex-col gap-2 sm:flex-row">
              <SubmitButton variant="danger" pendingLabel="Canceling…">
                Cancel the job and tell the customer
              </SubmitButton>
              <Button type="button" variant="secondary" size="lg" onClick={() => setConfirming(false)}>
                <X className="h-4 w-4" aria-hidden /> Keep it
              </Button>
            </div>
          </form>
        ) : (
          <>
            <FormMessage error={cancelState.error} notice={cancelState.notice} />
            <div className="mt-5">
              <Button type="button" variant="danger" onClick={() => setConfirming(true)}>
                <Ban className="h-4 w-4" aria-hidden /> Cancel this job
              </Button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
