"use client";

import { useActionState } from "react";
import { ExternalLink, LoaderCircle } from "lucide-react";

import { saveLicenseStatus, type LicenseState } from "@/app/settings/business/actions";
import { Field, FormMessage, TextInput } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import { Banner } from "@/components/ui/banner";
import { CSLB_LOOKUP_URL, LICENSE_STATUSES, type LicenseWarning } from "@/lib/license-status";

const initial: LicenseState = { error: "" };

export type LicenseDetails = { status: string; expiresOn: string; verifiedOn: string };

/**
 * The license as CSLB's lookup shows it (compliance CSLB-001-002). The owner
 * checks it there and enters what it says; when it is recorded as lapsed,
 * invoices and pay links wait for an acknowledgement here.
 */
export function LicenseStatusCard({ details, warning, canManage }: { details: LicenseDetails; warning: LicenseWarning; canManage: boolean }) {
  const [state, action, pending] = useActionState(saveLicenseStatus, initial);
  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <h2 className="text-sm font-semibold">License status</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Check your license on{" "}
        <a href={CSLB_LOOKUP_URL} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-semibold text-brand underline">
          CSLB&apos;s license lookup <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>{" "}
        and enter what it shows. California doesn&apos;t let an unlicensed contractor collect payment for the work.
      </p>
      {warning.level !== "none" ? (
        <div className="mt-3">
          <Banner tone={warning.level === "lapsed" && !warning.acknowledged ? "critical" : "caution"}>
            {warning.message}
            {warning.level === "lapsed" && !warning.acknowledged ? " Invoices and pay links wait until you update it or acknowledge it below." : ""}
          </Banner>
        </div>
      ) : null}
      <form action={action} className="mt-4">
        <fieldset disabled={!canManage || pending} className="space-y-4 disabled:opacity-60">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Status on CSLB">
              <SelectField
                name="licenseStatus"
                label="Status on CSLB"
                defaultValue={details.status}
                choices={[{ value: "", label: "Not entered" }, ...LICENSE_STATUSES.map((status) => ({ value: status, label: status[0]!.toUpperCase() + status.slice(1) }))]}
              />
            </Field>
            <Field label="Expires">
              <TextInput name="licenseExpiresOn" type="date" defaultValue={details.expiresOn} />
            </Field>
            <Field label="Last checked">
              <TextInput name="licenseVerifiedOn" type="date" defaultValue={details.verifiedOn} />
            </Field>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="submit"
              name="intent"
              value="checked_today"
              className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand"
            >
              {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              Save, checked today
            </button>
            <button type="submit" name="intent" value="save" className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-5 text-sm font-semibold">
              Save
            </button>
            {warning.level === "lapsed" && !warning.acknowledged ? (
              <button
                type="submit"
                name="intent"
                value="acknowledge"
                className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-critical px-5 text-sm font-semibold text-critical"
              >
                I understand, keep billing for 7 days
              </button>
            ) : null}
          </div>
        </fieldset>
      </form>
      <FormMessage error={state.error} notice={state.notice} />
    </section>
  );
}
