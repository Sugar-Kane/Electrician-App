"use client";

import { useActionState, useMemo, useState } from "react";

import { saveDiagnosticPaymentSettings, type DiagnosticSettingsState } from "./diagnostic-actions";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field, FormMessage, TextInput } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";
import {
  authorizationText,
  effectiveDiagnosticPolicy,
  priceSummary,
  type DiagnosticPaymentSettings,
} from "@/lib/diagnostic-payment-policy";

function Toggle({ name, label, hint, defaultChecked, disabled }: { name: string; label: string; hint: string; defaultChecked: boolean; disabled?: boolean }) {
  return (
    <label className={`tap-target flex items-start gap-3 rounded-control border border-line bg-raised p-4 ${disabled ? "opacity-60" : "cursor-pointer"}`}>
      <input type="checkbox" name={name} defaultChecked={defaultChecked} disabled={disabled} className="mt-1 h-5 w-5 shrink-0 accent-brand" />
      <span>
        <span className="block text-sm font-semibold text-ink">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-ink-faint">{hint}</span>
      </span>
    </label>
  );
}

/** Diagnostic Payment Settings: the contractor's preferences, with the law shown on top. */
export function DiagnosticSettingsForm({
  settings,
  businessName,
  canEdit,
  baseState,
}: {
  settings: DiagnosticPaymentSettings;
  businessName: string;
  canEdit: boolean;
  baseState: string;
}) {
  const [state, action] = useActionState<DiagnosticSettingsState, FormData>(saveDiagnosticPaymentSettings, { error: "" });
  const [jurisdiction, setJurisdiction] = useState(settings.jurisdiction || baseState || "");
  const [fee, setFee] = useState((settings.feeCents / 100).toFixed(2));
  const [collectAt, setCollectAt] = useState(settings.collectAt);
  const feeCents = Math.round(Number(fee || 0) * 100) || 0;
  const policy = useMemo(
    () => effectiveDiagnosticPolicy({ ...settings, feeCents, jurisdiction, collectAt }),
    [settings, feeCents, jurisdiction, collectAt],
  );
  const deferredByLaw = Boolean(policy.rule?.deferDiagnosticFee);

  return (
    <section aria-labelledby="diagnostic-settings" className="mt-4 rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 id="diagnostic-settings" className="text-base font-semibold">Diagnostic Payment Settings</h2>
      <p className="mt-1 text-sm leading-6 text-ink-muted">
        How the diagnostic fee is presented, authorized and collected on every booking channel: your booking page, texts, the phone assistant and ChatGPT/Claude.
      </p>

      {deferredByLaw ? (
        <Banner tone="info" className="mt-4">
          <span>
            <span>
              {policy.rule?.reason} Customers save a payment method when they book; the fee is charged only after you mark the diagnostic complete. This cannot be turned off for {jurisdiction || "a business with no jurisdiction set"}.
            </span>
          </span>
        </Banner>
      ) : null}

      <form action={action} className="mt-5 space-y-4">
        <fieldset disabled={!canEdit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Diagnostic fee" hint="The amount customers authorize. Changing it affects new bookings only.">
              <TextInput name="fee" inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value.replace(/[^0-9.]/g, ""))} />
            </Field>
            <Field label="Operating jurisdiction" hint="Two-letter state. Its rules override the choices below.">
              <TextInput
                name="jurisdiction"
                maxLength={2}
                value={jurisdiction}
                onChange={(event) => setJurisdiction(event.target.value.toUpperCase().replace(/[^A-Z]/g, ""))}
                placeholder="CA"
              />
            </Field>
          </div>

          <Field label="When the diagnostic fee is collected" group hint={deferredByLaw ? "Upfront collection is not available in this jurisdiction." : undefined}>
            <SelectField
              name="collectAt"
              label="When the diagnostic fee is collected"
              value={deferredByLaw ? "after_completion" : collectAt}
              onChange={(value) => setCollectAt(value === "at_booking" && !deferredByLaw ? "at_booking" : "after_completion")}
              choices={[
                { value: "after_completion", label: "After the diagnostic is completed (save a payment method at booking)" },
                ...(deferredByLaw ? [] : [{ value: "at_booking", label: "At booking (upfront)" }]),
              ]}
            />
          </Field>

          <div className="grid gap-3 lg:grid-cols-2">
            <Toggle name="requirePaymentMethod" label="Require a payment method to book online" hint="Customers authorize and save a card with Stripe. Nothing is charged at booking." defaultChecked={settings.requirePaymentMethod} />
            <Toggle name="autoCollect" label="Collect automatically on completion" hint="When a standalone diagnostic is marked complete with findings, charge the authorized amount to the saved card." defaultChecked={settings.autoCollect} />
            <Toggle name="allowManual" label="Allow collecting by hand after completion" hint="Lets owners and billing staff press Collect on a completed diagnostic." defaultChecked={settings.allowManualAfterCompletion} />
            <Toggle name="credit" label="Credit the diagnostic toward approved repairs" hint="Applied once, as a prior payment, on the repair invoice. Subject to your contract and accounting treatment." defaultChecked={settings.creditTowardRepairs} />
            <Toggle name="reminders" label="Send payment method setup reminders" hint="Remind customers whose time is held but who have not saved a card." defaultChecked={settings.sendSetupReminders} />
            <Toggle name="failedNotices" label="Send failed-payment notices" hint="Text and email the customer a secure link when a charge for a completed service fails." defaultChecked={settings.sendFailedPaymentNotices} />
          </div>

          <Field label="Customer-facing service description" hint="Shown as the line item on booking pages. Leave empty for “Electrical Diagnostic Service”.">
            <TextInput name="description" maxLength={300} defaultValue={settings.serviceDescription} placeholder="Electrical Diagnostic Service" />
          </Field>
        </fieldset>

        <div className="rounded-control border border-line bg-raised p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">What customers see</p>
          <dl className="mt-2 divide-y divide-line text-sm">
            {priceSummary(policy).map((row) => (
              <div key={row.label} className="flex justify-between gap-4 py-1.5">
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className="font-semibold text-ink">{row.amount}</dd>
              </div>
            ))}
          </dl>
          {policy.collectAt === "after_completion" ? (
            <p className="mt-2 text-xs leading-5 text-ink-muted">“{authorizationText({ businessName, feeCents })}”</p>
          ) : null}
        </div>

        {canEdit ? (
          <Button type="submit">Save diagnostic payment settings</Button>
        ) : (
          <p className="text-sm text-ink-faint">Only an owner or admin can change these settings.</p>
        )}
        <FormMessage error={state.error} notice={state.notice} />
      </form>
    </section>
  );
}
