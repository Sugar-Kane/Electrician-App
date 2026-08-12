"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Save } from "lucide-react";

import { saveBusinessDetails, type BusinessState } from "@/app/settings/business/actions";
import { Field, FormMessage, SelectInput, TextInput } from "@/components/ui/field";
import { TIMEZONE_OPTIONS } from "@/lib/timezones";

const initialState: BusinessState = { error: "" };

function SaveButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Save className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Saving" : "Save"}
    </button>
  );
}

export type BusinessDetails = {
  name: string;
  phone: string;
  addressLine1: string;
  city: string;
  state: string;
  postalCode: string;
  timezone: string;
};

export function BusinessDetailsForm({
  details,
  canManage,
}: {
  details: BusinessDetails;
  canManage: boolean;
}) {
  const [state, action] = useActionState(saveBusinessDetails, initialState);

  return (
    <form action={action} className="space-y-4">
      {/*
        A technician could fill this whole form in and only find out on Save
        that RLS would refuse it — "Those details could not be saved.", which
        reads like a bug rather than a permission. The account page has always
        disabled its controls and said why; this page never did.
      */}
      {!canManage ? (
        <p className="rounded-control border border-line bg-raised p-4 text-sm text-ink-muted">
          Only an owner or administrator can change the business details. You
          can see what they are set to.
        </p>
      ) : null}

      {/*
        A fieldset rather than a `disabled` on each input: it is the browser's
        own answer to "none of this is editable", so a control added later is
        covered without anybody remembering to thread the flag through it.
      */}
      <fieldset disabled={!canManage} className="space-y-4 disabled:opacity-60">
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Business name" hint="Customers see this on every text and email.">
              <TextInput name="name" defaultValue={details.name} required />
            </Field>
          </div>

          <Field label="Phone" hint="The number customers are told to call back on.">
            <TextInput name="phone" type="tel" defaultValue={details.phone} placeholder="209-626-9313" />
          </Field>

          <Field label="Timezone" hint="Arrival windows and quiet hours use this.">
            <SelectInput name="timezone" defaultValue={details.timezone}>
              {TIMEZONE_OPTIONS.map((zone) => (
                <option key={zone.value} value={zone.value}>
                  {zone.label}
                </option>
              ))}
            </SelectInput>
          </Field>
        </div>
      </section>

      <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Where you work from</h2>
        <p className="mt-1 text-sm text-ink-muted">
          Routes start here when nobody has shared a location.
        </p>

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Street address">
              <TextInput name="addressLine1" defaultValue={details.addressLine1} />
            </Field>
          </div>
          <Field label="City">
            <TextInput name="city" defaultValue={details.city} />
          </Field>
          <Field label="State">
            <TextInput name="state" defaultValue={details.state} maxLength={2} />
          </Field>
          <Field label="ZIP">
            <TextInput name="postalCode" defaultValue={details.postalCode} />
          </Field>
        </div>
      </section>
      </fieldset>

      <FormMessage error={state.error} notice={state.notice} />
      <SaveButton disabled={!canManage} />
    </form>
  );
}
