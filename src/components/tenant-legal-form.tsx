"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ExternalLink, Globe, LoaderCircle, TriangleAlert } from "lucide-react";

import {
  saveTenantLegalPage,
  type LegalPageActionState,
} from "@/app/settings/legal/actions";
import type { OwnTenantLegalPage } from "@/lib/tenant-legal";
import { Banner } from "@/components/ui/banner";

const initialState: LegalPageActionState = { error: "" };
const inputClass =
  "mt-2 min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base text-white outline-none placeholder:text-ink-faint focus:border-brand/70";

function SaveButton({ publishing }: { publishing: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand disabled:cursor-wait disabled:opacity-70"
    >
      {pending ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : null}
      {pending ? "Saving…" : publishing ? "Save and publish" : "Save"}
    </button>
  );
}

export function TenantLegalForm({ page }: { page: OwnTenantLegalPage }) {
  const [state, formAction] = useActionState(saveTenantLegalPage, initialState);
  const [supportEmail, setSupportEmail] = useState(page.supportEmail);
  const [published, setPublished] = useState(page.published);

  // The seeded address is the owner's login, which is often personal. Say so
  // until it has been changed or deliberately kept.
  const usingLoginEmail =
    supportEmail.length > 0 &&
    supportEmail.toLowerCase() === page.ownerLoginEmail.toLowerCase();

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="organizationId" value={page.organizationId} />

      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Business details</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          These appear on your public Privacy Policy and Text Message Terms. Mobile
          carriers read those pages when they review your messaging campaign, so the
          details have to match your registered business.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Registered legal business name</span>
            <input name="legalBusinessName" defaultValue={page.legalBusinessName} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">
              Trading name <span className="text-ink-faint">(optional)</span>
            </span>
            <input name="dbaName" defaultValue={page.dbaName} className={inputClass} placeholder="Pacific Plains Electric" />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Support phone</span>
            <input name="supportPhone" type="tel" inputMode="tel" defaultValue={page.supportPhone} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Support email</span>
            <input
              name="supportEmail"
              type="email"
              inputMode="email"
              value={supportEmail}
              onChange={(event) => setSupportEmail(event.target.value)}
              className={inputClass}
            />
          </label>
          <label className="block sm:col-span-2">
            <span className="text-sm font-medium text-ink">Mailing address</span>
            <input name="mailingAddress" defaultValue={page.mailingAddress} className={inputClass} />
          </label>
        </div>

        {usingLoginEmail ? (
          <p className="mt-4 flex items-start gap-2 rounded-control border border-caution/25 bg-caution-bg p-4 text-sm leading-6 text-caution">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            This is the email you signed in with. It was filled in as a starting point
            and will be published for customers and carriers to contact you. Change it
            if you would rather show a business address.
          </p>
        ) : null}
      </section>

      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Text message program</h2>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block">
            <span className="text-sm font-medium text-ink">Program name</span>
            <input name="programName" defaultValue={page.programName} className={inputClass} />
          </label>
          <label className="block">
            <span className="text-sm font-medium text-ink">Message frequency</span>
            <input name="messageFrequency" defaultValue={page.messageFrequency} className={inputClass} />
          </label>
        </div>
      </section>

      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h2 className="text-lg font-semibold">Publish</h2>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Your pages stay private until you publish them. A messaging campaign cannot
          be approved while they are private — the reviewer has to be able to open
          them without signing in.
        </p>

        <label className="tap-target mt-4 flex cursor-pointer items-start gap-3 rounded-control border border-line bg-raised p-4">
          <input
            type="checkbox"
            name="published"
            checked={published}
            onChange={(event) => setPublished(event.target.checked)}
            className="mt-1 h-5 w-5 shrink-0 accent-brand"
          />
          <span className="text-sm leading-6 text-ink-muted">
            <span className="font-semibold text-white">Publish these pages</span>
            <span className="mt-1 block">
              I have checked the details above and they are correct to show publicly.
            </span>
          </span>
        </label>

        {page.slug ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <a
              href={`/legal/${page.slug}/privacy`}
              target="_blank"
              rel="noreferrer"
              className="tap-row flex min-h-12 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-brand" aria-hidden /> Preview Privacy Policy
              </span>
              <ExternalLink className="h-4 w-4 text-ink-faint" aria-hidden />
            </a>
            <a
              href={`/legal/${page.slug}/terms`}
              target="_blank"
              rel="noreferrer"
              className="tap-row flex min-h-12 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"
            >
              <span className="flex items-center gap-2">
                <Globe className="h-4 w-4 text-brand" aria-hidden /> Preview Text Message Terms
              </span>
              <ExternalLink className="h-4 w-4 text-ink-faint" aria-hidden />
            </a>
          </div>
        ) : null}
      </section>

      {state.error ? (
        <Banner tone="critical">{state.error}</Banner>
      ) : null}
      {state.saved ? (
        <Banner tone="positive">Saved.</Banner>
      ) : null}

      <SaveButton publishing={published && !page.published} />
    </form>
  );
}
