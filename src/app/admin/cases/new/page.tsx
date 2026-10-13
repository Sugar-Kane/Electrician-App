import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, Link2, TriangleAlert } from "lucide-react";

import { Card } from "@/components/admin-ui";
import { DateTimeField } from "@/components/ui/date-time-field";
import { SelectField } from "@/components/ui/select-field";
import { listOrganizations, requirePlatformAdmin } from "@/lib/admin-console";
import { CASE_CATEGORIES, CASE_SEVERITIES } from "@/lib/support-cases";
import { DEFAULT_TIMEZONE, TIMEZONE_OPTIONS } from "@/lib/timezones";

import { openCase } from "../actions";

export const metadata: Metadata = {
  title: "Open a case | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LINK_TYPES = new Set(["business", "message", "booking", "job", "customer", "payment", "assistant", "operation"]);

/** A visible name above a field whose own label is only announced. */
function Labeled({ text, children }: { text: string; children: React.ReactNode }) {
  return (
    <div>
      <span className="text-sm font-medium">{text}</span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

const inputClass =
  "w-full rounded-control border border-line bg-raised px-3 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70";

/**
 * A new case, usually opened from the record it is about: the business and the
 * record come filled in, so the case starts linked to what support was looking
 * at. The person who opens it owns it, with an update owed tomorrow.
 */
export default async function NewCasePage({
  searchParams,
}: {
  searchParams: Promise<{ org?: string; type?: string; id?: string; label?: string; category?: string; error?: string }>;
}) {
  await requirePlatformAdmin();
  const [query, organizations] = await Promise.all([searchParams, listOrganizations()]);
  const business = organizations.find((entry) => entry.id === query.org);
  const link = query.type && LINK_TYPES.has(query.type) && UUID.test(query.id ?? "") ? { type: query.type, id: query.id!, label: (query.label ?? "").slice(0, 120) } : null;
  const category = CASE_CATEGORIES.some((entry) => entry.value === query.category) ? query.category! : "other";
  const zone = business?.timeZone || DEFAULT_TIMEZONE;

  return (
    <div className="space-y-4">
      <Link href={business ? `/admin/organizations/${business.id}` : "/admin/cases"} className="inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {business ? business.name : "Cases"}
      </Link>
      <Card title="Open a case">
        {query.error ? (
          <p className="mb-4 flex items-start gap-2 rounded-control border border-critical/30 bg-critical-bg p-3 text-sm text-critical">
            <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {query.error}
          </p>
        ) : null}
        <form action={openCase} className="space-y-4">
          {link ? (
            <>
              <input type="hidden" name="linkType" value={link.type} />
              <input type="hidden" name="linkId" value={link.id} />
              <input type="hidden" name="linkLabel" value={link.label} />
              <p className="flex items-center gap-2 rounded-control border border-line p-3 text-sm">
                <Link2 className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                About: <span className="font-semibold">{link.label || link.type}</span>
              </p>
            </>
          ) : null}
          <div className="grid gap-3 sm:grid-cols-3">
            <Labeled text="Business">
              <SelectField
                name="organizationId"
                label="Business"
                defaultValue={business?.id ?? ""}
                placeholder="No particular business"
                choices={[{ value: "", label: "No particular business" }, ...organizations.map((entry) => ({ value: entry.id, label: entry.name }))]}
              />
            </Labeled>
            <Labeled text="What it's about">
              <SelectField name="category" label="What it's about" defaultValue={category} choices={CASE_CATEGORIES} />
            </Labeled>
            <Labeled text="How bad">
              <SelectField name="severity" label="How bad" defaultValue="normal" choices={CASE_SEVERITIES} />
            </Labeled>
          </div>
          <label className="block">
            <span className="text-sm font-medium">What&rsquo;s wrong</span>
            <textarea name="symptom" required minLength={3} maxLength={2000} rows={3} placeholder="In the words of whoever reported it, e.g. the customer says no reminder came for Tuesday" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">What happened before it</span>
            <textarea name="steps" maxLength={4000} rows={3} placeholder="What they did, in order, if they know" className={`mt-1 ${inputClass}`} />
          </label>
          <label className="block">
            <span className="text-sm font-medium">Who reported it</span>
            <input name="reporter" maxLength={300} placeholder="Name, role, and how to reach them" className={`mt-1 min-h-11 ${inputClass}`} />
          </label>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <div>
              <span className="text-sm font-medium">When it happened</span>
              <div className="mt-1">
                <DateTimeField name="occurredAt" label="When it happened" timeZone={zone} />
              </div>
            </div>
            <Labeled text="In which time zone">
              <SelectField name="zone" label="In which time zone" defaultValue={zone} choices={TIMEZONE_OPTIONS} />
            </Labeled>
          </div>
          <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
            Open the case
          </button>
        </form>
      </Card>
    </div>
  );
}
