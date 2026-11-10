"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Pencil } from "lucide-react";

import { saveCustomerDetailsAction, type CustomerDetailsState } from "@/app/customers/[customerId]/actions";
import { AddressFields } from "@/components/ui/address-fields";
import { inputClass } from "@/components/ui/field";
import type { CustomerDetails } from "@/lib/customer-details";

const initial: CustomerDetailsState = { error: "" };

function Save() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60 sm:w-auto"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {pending ? "Saving…" : "Save details"}
    </button>
  );
}

function Text({ name, label, defaultValue, type = "text", autoComplete, inputMode }: {
  name: string;
  label: string;
  defaultValue: string;
  type?: string;
  autoComplete?: string;
  inputMode?: "tel" | "email" | "text";
}) {
  return (
    <label className="grid gap-1 text-xs font-semibold text-ink-muted">
      {label}
      <input name={name} type={type} defaultValue={defaultValue} autoComplete={autoComplete} inputMode={inputMode} className={inputClass} />
    </label>
  );
}

/**
 * Change a customer's details at any time. One address is enough, personal or
 * business; invoices and contracts go to whichever party is chosen here.
 */
export function CustomerDetailsForm({
  customerId,
  details,
  personalDefault,
}: {
  customerId: string;
  details: CustomerDetails;
  /** The service address, offered as the personal address when none is saved. */
  personalDefault: CustomerDetails["personalAddress"] | null;
}) {
  const [state, action] = useActionState(saveCustomerDetailsAction, initial);
  const [businessName, setBusinessName] = useState(details.businessName);
  const personal = details.personalAddress.line1 ? details.personalAddress : (personalDefault ?? details.personalAddress);

  return (
    <details className="mt-4 rounded-control border border-line p-3" open={Boolean(state.error)}>
      <summary className="tap-target flex cursor-pointer items-center gap-2 text-sm font-semibold text-ink">
        <Pencil className="h-4 w-4" aria-hidden />
        Edit details
      </summary>
      <form action={action} className="mt-3 grid gap-4">
        <input type="hidden" name="customerId" value={customerId} />

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Person</legend>
          <Text name="firstName" label="First name" defaultValue={details.firstName} autoComplete="given-name" />
          <Text name="lastName" label="Last name" defaultValue={details.lastName} autoComplete="family-name" />
          <Text name="phone" label="Phone" defaultValue={details.phone} type="tel" inputMode="tel" autoComplete="tel" />
          <Text name="email" label="Email" defaultValue={details.email} type="email" inputMode="email" autoComplete="email" />
          <label className="grid gap-1 text-xs font-semibold text-ink-muted sm:col-span-2">
            Prefers
            <select name="preferredContact" defaultValue={details.preferredContact} className={inputClass}>
              <option value="">No preference</option>
              <option value="sms">Text</option>
              <option value="phone">Call</option>
              <option value="email">Email</option>
            </select>
          </label>
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Personal address</legend>
          <AddressFields defaults={personal} withUnit hint="Where they get mail. Leave empty if you give a business address." />
        </fieldset>

        <fieldset className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Business (optional)</legend>
          <label className="grid gap-1 text-xs font-semibold text-ink-muted sm:col-span-2">
            Business name
            <input name="businessName" defaultValue={details.businessName} onChange={(event) => setBusinessName(event.target.value)} autoComplete="organization" className={inputClass} />
          </label>
          <AddressFields defaults={details.businessAddress} withUnit namePrefix="business_" hint="The business's mailing address. Leave empty if you give a personal address." />
        </fieldset>

        <fieldset className="grid gap-2">
          <legend className="mb-1 text-sm font-semibold text-ink">Send invoices and contracts to</legend>
          <label className="flex items-start gap-2 text-sm text-ink">
            <input type="radio" name="billTo" value="person" defaultChecked={details.billTo !== "business"} className="mt-1" />
            The person: their name and personal address
          </label>
          <label className={`flex items-start gap-2 text-sm ${businessName.trim() ? "text-ink" : "text-ink-faint"}`}>
            <input type="radio" name="billTo" value="business" defaultChecked={details.billTo === "business"} disabled={!businessName.trim()} className="mt-1" />
            The business: its name and business address{businessName.trim() ? "" : " (add a business name first)"}
          </label>
          <p className="text-xs text-ink-faint">One address is required, personal or business. If the chosen one is empty, the other is used.</p>
        </fieldset>

        <div>
          <Save />
          {state.error ? (
            <p role="alert" className="mt-2 text-sm font-semibold text-critical">
              {state.error}
            </p>
          ) : state.notice ? (
            <p role="status" className="mt-2 text-sm text-positive">
              {state.notice}
            </p>
          ) : null}
        </div>
      </form>
    </details>
  );
}
