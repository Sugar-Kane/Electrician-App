import type { Metadata } from "next";
import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { SelectField } from "@/components/ui/select-field";
import { ACTIVITY_ACTIONS, activityFacts, activitySentence } from "@/lib/admin-activity";
import { listAuditPage, listOrganizations } from "@/lib/admin-console";

export const metadata: Metadata = {
  title: "Activity | Volteira support",
  robots: { index: false, follow: false },
};

const PAGE = 50;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What support has done.
 *
 * Looking inside a business's records reaches names, addresses, and phone
 * numbers belonging to people who never agreed to be seen by the platform. This
 * page is the answer to "who looked, and when" — including for whoever is
 * reading it. Each time is in that business's own zone; hover for UTC.
 */
export default async function AdminAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ business?: string; action?: string; before?: string }>;
}) {
  const params = await searchParams;
  const business = UUID.test(params.business ?? "") ? params.business! : "";
  const action = ACTIVITY_ACTIONS.some((entry) => entry.value === params.action) ? params.action! : "";
  const before = params.before && !Number.isNaN(new Date(params.before).getTime()) ? params.before : "";

  const [entries, organizations] = await Promise.all([
    listAuditPage({ organizationId: business, action, before, limit: PAGE }),
    listOrganizations(),
  ]);

  const filtered = Boolean(business || action);
  const older = entries.length === PAGE ? entries[entries.length - 1]?.createdAt : "";
  const olderHref = older
    ? `/admin/audit?${new URLSearchParams({
        ...(business ? { business } : {}),
        ...(action ? { action } : {}),
        before: older,
      }).toString()}`
    : "";

  return (
    <div className="space-y-3">
      <form action="/admin/audit" className="rounded-panel border border-line bg-surface p-4">
        <p className="text-sm text-ink-muted">
          Every time a business&rsquo;s records were opened, an invitation was sent, or somebody made changes inside
          a business.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
          <SelectField
            name="business"
            label="Business"
            defaultValue={business}
            placeholder="Every business"
            choices={[
              { value: "", label: "Every business" },
              ...organizations.map((organization) => ({ value: organization.id, label: organization.name })),
            ]}
          />
          <SelectField
            name="action"
            label="Action"
            defaultValue={action}
            placeholder="Every action"
            choices={[{ value: "", label: "Every action" }, ...ACTIVITY_ACTIONS]}
          />
          <div className="flex gap-2">
            <button type="submit" className="tap-target flex-1 rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
              Show
            </button>
            {filtered || before ? (
              <Link href="/admin/audit" className="tap-target inline-flex items-center rounded-control border border-line px-4 text-sm font-semibold">
                Clear
              </Link>
            ) : null}
          </div>
        </div>
      </form>

      {entries.map((entry) => {
        const facts = activityFacts(entry.action, entry.detail);
        return (
          <div key={entry.id} className="rounded-control border border-line bg-surface p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-semibold">
                {activitySentence(entry.action, entry.organizationName, entry.detail)}
              </p>
              <p className="text-xs text-ink-faint">
                <AdminTime iso={entry.createdAt} timeZone={entry.timeZone} />
              </p>
            </div>
            <p className="mt-1 text-sm text-ink-muted">By {entry.adminEmail || "an unknown account"}</p>
            {facts.length > 0 ? (
              <dl className="mt-2 grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
                {facts.map((fact) => (
                  <div key={fact.label} className="contents">
                    <dt className="text-ink-faint">{fact.label}</dt>
                    <dd className="min-w-0 break-words text-ink-muted">{fact.value}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </div>
        );
      })}

      {entries.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface p-5 text-sm text-ink-muted">
          {filtered || before ? "Nothing matches." : "Nothing yet."}
        </p>
      ) : null}

      {olderHref ? (
        <Link href={olderHref} className="tap-target flex items-center justify-center rounded-control border border-line text-sm font-semibold">
          Older
        </Link>
      ) : null}
    </div>
  );
}
