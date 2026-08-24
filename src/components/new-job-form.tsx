"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useActionState } from "react";
import { FileText, LoaderCircle, Plus, X } from "lucide-react";

import { createJob, type NewJobState } from "@/app/jobs/new/actions";
import { AddressFields } from "@/components/ui/address-fields";
import { DateTimeField } from "@/components/ui/date-time-field";
import { Field, FormMessage, TextInput, inputClass } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { WorkOrderLines } from "@/components/work-order-lines";
import { keepMoneyCharacters } from "@/lib/money-input";
import { DIAGNOSTIC_MINUTES, JOB_CATEGORIES } from "@/lib/new-job-input";

/**
 * Writing a job down.
 *
 * Grouped the way the owner already thinks about it: who it is for, where the
 * work is, what the work is. The cost sits last and is optional, because
 * raising an invoice at the same moment is a normal thing to do and also a
 * normal thing not to have decided yet.
 *
 * Two things changed the shape of this form. The first is that a rejected save
 * used to empty it — every input was uncontrolled with no `defaultValue`, so
 * React reset the lot when the action returned, and a mistyped price cost
 * somebody the customer's name, number and address as well. Everything now
 * reads its starting value from what was last posted.
 *
 * The second is that saving is three decisions, not one: finish it, keep what
 * there is so far, or walk away. One button could only ever mean the first.
 */

const initialState: NewJobState = { error: "" };

const DIAGNOSTIC_HOURS = String(DIAGNOSTIC_MINUTES / 60);

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function NewJobForm({
  timeZone,
  timeZoneLabel,
}: {
  /** The IANA zone, so the calendar rings today on the right day. */
  timeZone: string;
  timeZoneLabel: string;
}) {
  const [state, action, pending] = useActionState(createJob, initialState);

  /** Whatever was last posted, so a rejected save leaves the screen alone. */
  const kept = state.values;

  const [category, setCategory] = useState(kept?.category || "diagnostic");
  const [duration, setDuration] = useState(kept?.durationHours ?? "");
  const [cost, setCost] = useState(kept?.cost ?? "");

  /*
   * Which button was pressed.
   *
   * A hidden input rather than three submit buttons with the same name,
   * because the panel is long and on a phone the buttons are pinned to the
   * bottom outside the flow — a `formAction` would have been the tidier answer
   * if they were in it.
   */
  const mode = useRef<HTMLInputElement>(null);
  const description = useRef<HTMLTextAreaElement>(null);

  const diagnostic = category === "diagnostic";

  function submitAs(next: "save" | "draft") {
    if (mode.current) mode.current.value = next;
  }

  return (
    <form action={action} className="space-y-3">
      <input ref={mode} type="hidden" name="mode" defaultValue="save" />

      <Section title="Customer">
        <Field label="Name">
          <TextInput
            name="customerName"
            required
            autoComplete="off"
            defaultValue={kept?.customerName ?? ""}
            placeholder="Jane Doe"
          />
        </Field>
        <Field label="Mobile number" hint="Used for booking confirmations and cancellations.">
          <TextInput
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={kept?.phone ?? ""}
            placeholder="805-555-0142"
          />
        </Field>
        <Field
          label="Email"
          hint="Either a mobile number or an email is needed, so the customer can be reached."
        >
          <TextInput
            name="email"
            type="email"
            autoComplete="off"
            defaultValue={kept?.email ?? ""}
            placeholder="jane@example.com"
          />
        </Field>
      </Section>

      <Section title="Where the work is">
        <AddressFields
          defaults={{
            line1: kept?.addressLine1 ?? "",
            city: kept?.city ?? "",
            state: kept?.state ?? "",
            postalCode: kept?.postalCode ?? "",
          }}
        />
      </Section>

      <Section title="The work">
        <Field label="Kind of work">
          <SelectField
            name="category"
            value={category}
            onChange={setCategory}
            label="Type of work"
            choices={JOB_CATEGORIES}
          />
        </Field>

        <Field
          label="How long it should take"
          hint={
            diagnostic
              ? "A diagnostic is two hours. That is what the fee is quoted for."
              : "Hours. Two if left blank."
          }
        >
          <TextInput
            name="durationHours"
            inputMode="decimal"
            // Set here as well as on the server. The lock is a courtesy on
            // screen; the parser is what actually decides.
            value={diagnostic ? DIAGNOSTIC_HOURS : duration}
            onChange={(event) => setDuration(event.target.value)}
            readOnly={diagnostic}
            aria-readonly={diagnostic}
            className={diagnostic ? "opacity-70" : ""}
            placeholder="2"
          />
        </Field>

        <Field
          label="Start"
          hint={`Times are ${timeZoneLabel}. Leave blank to save it unscheduled.`}
          group
        >
          <DateTimeField
            name="startLocal"
            label="Start"
            timeZone={timeZone}
            defaultValue={kept?.startLocal ?? ""}
          />
        </Field>

        <Field
          label="Cost"
          hint="Optional. A figure here raises a draft invoice, which is not sent until you send it."
        >
          <TextInput
            name="cost"
            // `decimal` rather than `numeric`: a number pad with no decimal
            // point cannot type a price. Letters are filtered as they arrive,
            // so the unreadable value never exists in the first place.
            inputMode="decimal"
            value={cost}
            onChange={(event) => setCost(keepMoneyCharacters(event.target.value))}
            placeholder="1280.00"
          />
        </Field>

        <div className="sm:col-span-2">
          <Field label="What the customer said">
            <textarea
              ref={description}
              name="description"
              rows={3}
              defaultValue={kept?.description ?? ""}
              placeholder="Panel is buzzing and the kitchen breaker keeps tripping."
              className={`${inputClass} min-h-24 py-3`}
            />
          </Field>
        </div>

        {diagnostic ? null : (
          <WorkOrderLines
            describedBy={() => description.current?.value ?? ""}
            defaultValue={kept?.workOrderLines ?? ""}
          />
        )}
      </Section>

      <FormMessage error={state.error} />

      {/*
        Three decisions, in the order they are made: finish it, keep it for now,
        or walk away. Full width and stacked on a phone, so nothing here needs
        aiming at.
      */}
      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:items-center">
        <button
          type="submit"
          onClick={() => submitAs("save")}
          disabled={pending}
          className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60 sm:w-auto"
        >
          {pending ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="h-4 w-4" aria-hidden />
          )}
          {pending ? "Saving" : "Save"}
        </button>

        <button
          type="submit"
          onClick={() => submitAs("draft")}
          disabled={pending}
          className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-control border border-line px-5 text-sm font-semibold text-ink disabled:opacity-60 sm:w-auto"
        >
          <FileText className="h-4 w-4" aria-hidden />
          Save as draft
        </button>

        <Link
          href="/schedule"
          className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-control px-5 text-sm font-semibold text-ink-muted sm:w-auto"
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </Link>
      </div>

      <p className="text-xs leading-5 text-ink-faint">
        A draft is saved without a time and without chasing the customer. It stays on the schedule
        as yours to finish.
      </p>
    </form>
  );
}
