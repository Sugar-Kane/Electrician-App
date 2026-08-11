"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Plus } from "lucide-react";

import { createJob, type NewJobState } from "@/app/jobs/new/actions";
import { Field, FormMessage, SelectInput, TextInput, inputClass } from "@/components/ui/field";
import { JOB_CATEGORIES } from "@/lib/new-job-input";

/**
 * Writing a job down.
 *
 * Grouped the way the owner already thinks about it: who it is for, where the
 * work is, what the work is. The cost sits last and is optional, because
 * raising an invoice at the same moment is a normal thing to do and also a
 * normal thing not to have decided yet.
 *
 * Nothing here is marked required except the name — the address can be filled
 * in later, and a form that refuses to save a job because nobody asked for the
 * ZIP code is a form people stop using.
 */

const initialState: NewJobState = { error: "" };

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60 sm:w-auto"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Plus className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Saving" : "Create job"}
    </button>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold uppercase tracking-[0.12em] text-ink-muted">{title}</h2>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
    </section>
  );
}

export function NewJobForm({ timeZoneLabel }: { timeZoneLabel: string }) {
  const [state, action] = useActionState(createJob, initialState);

  return (
    <form action={action} className="space-y-3">
      <Section title="Customer">
        <Field label="Name">
          <TextInput
            name="customerName"
            required
            autoComplete="off"
            placeholder="Dana Harper"
          />
        </Field>
        <Field label="Mobile number" hint="Used for booking confirmations and cancellations.">
          <TextInput name="phone" type="tel" autoComplete="off" placeholder="209-626-9313" />
        </Field>
        <Field
          label="Email"
          hint="Either a mobile number or an email is needed, so the customer can be reached."
        >
          <TextInput name="email" type="email" autoComplete="off" placeholder="dana@example.com" />
        </Field>
      </Section>

      <Section title="Where the work is">
        <Field label="Street address">
          <TextInput name="addressLine1" autoComplete="off" placeholder="994 Red Gum Lane" />
        </Field>
        <Field label="City">
          <TextInput name="city" autoComplete="off" placeholder="Nipomo" />
        </Field>
        <Field label="State">
          <TextInput name="state" autoComplete="off" placeholder="CA" maxLength={2} />
        </Field>
        <Field
          label="ZIP"
          hint="Leave the whole address blank if it is not known yet — it can be added later. A job with no address will not appear on the map."
        >
          <TextInput name="postalCode" autoComplete="off" placeholder="93444" />
        </Field>
      </Section>

      <Section title="The work">
        <Field label="Kind of work">
          <SelectInput name="category" defaultValue="diagnostic">
            {JOB_CATEGORIES.map((category) => (
              <option key={category.value} value={category.value}>
                {category.label}
              </option>
            ))}
          </SelectInput>
        </Field>
        <Field label="How long it should take" hint="Hours. Two if left blank.">
          <TextInput name="durationHours" inputMode="decimal" placeholder="2" />
        </Field>
        <Field label="Start" hint={`Times are ${timeZoneLabel}. Leave blank to save it unscheduled.`}>
          <TextInput name="startLocal" type="datetime-local" />
        </Field>
        <Field label="Cost" hint="Optional. A figure here raises a draft invoice, which is not sent until you send it.">
          <TextInput name="cost" inputMode="decimal" placeholder="1280.00" />
        </Field>
        <div className="sm:col-span-2">
          <Field label="What the customer said">
            <textarea
              name="description"
              rows={3}
              placeholder="Panel is buzzing and the kitchen breaker keeps tripping."
              className={`${inputClass} min-h-24 py-3`}
            />
          </Field>
        </div>
      </Section>

      <FormMessage error={state.error} />

      <div className="pt-1">
        <SubmitButton />
      </div>
    </form>
  );
}
