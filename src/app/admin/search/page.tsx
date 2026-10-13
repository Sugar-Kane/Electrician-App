import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Empty } from "@/components/admin-ui";
import { listOrganizations, requirePlatformAdmin, searchConsole, type SearchHit } from "@/lib/admin-console";

export const metadata: Metadata = {
  title: "Search | Volteira support",
  robots: { index: false, follow: false },
};

const GROUPS: { kind: SearchHit["kind"]; label: string }[] = [
  { kind: "business", label: "Businesses" },
  { kind: "person", label: "People" },
  { kind: "job", label: "Jobs" },
  { kind: "invoice", label: "Invoices" },
  { kind: "customer", label: "Customers" },
  { kind: "booking", label: "Bookings" },
];

/** Where a result opens: the exact record, inside its business. */
function hrefFor(hit: SearchHit): string {
  const business = `/admin/organizations/${hit.organizationId}`;
  switch (hit.kind) {
    case "business":
      return business;
    case "job":
      return `${business}/jobs/${hit.ref}`;
    case "invoice":
      return hit.ref ? `${business}/jobs/${hit.ref}#invoices` : `${business}?tab=money`;
    case "customer":
      return `${business}?tab=jobs&customer=${hit.ref}`;
    case "booking":
      return `${business}?tab=bookings#booking-${hit.ref}`;
    case "person":
      return hit.organizationId ? `${business}?tab=people` : "/admin/users";
  }
}

/**
 * One search for the whole platform.
 *
 * A business by name, a person by email, a job or invoice by number, a customer
 * or booking by part of a phone number, any record by id. Phone numbers come
 * back masked. Each search is recorded, because one box reaches every
 * business at once.
 */
export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requirePlatformAdmin();
  const { q = "" } = await searchParams;
  const query = q.trim().slice(0, 80);
  const [hits, organizations] = await Promise.all([
    query.length >= 2 ? searchConsole(query) : Promise.resolve([]),
    listOrganizations(),
  ]);
  const zones = new Map(organizations.map((organization) => [organization.id, organization.timeZone]));

  return (
    <div className="space-y-4">
      <form action="/admin/search" className="flex gap-2">
        <label className="flex min-h-12 min-w-0 flex-1 items-center rounded-control border border-line bg-raised px-4">
          <span className="sr-only">Search everything</span>
          <input
            name="q"
            defaultValue={query}
            autoFocus={!query}
            placeholder="Business, email, job #, invoice #, phone or id"
            className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint"
          />
        </label>
        <button className="tap-target shrink-0 rounded-control bg-brand px-5 text-sm font-bold text-on-brand">Search</button>
      </form>

      {query.length < 2 ? (
        <p className="px-1 text-sm text-ink-muted">
          Type at least two characters. A number finds job and invoice numbers; four or more digits also find phone
          numbers.
        </p>
      ) : hits.length === 0 ? (
        <Empty>Nothing matches &ldquo;{query}&rdquo;.</Empty>
      ) : (
        GROUPS.map((group) => {
          const found = hits.filter((hit) => hit.kind === group.kind);
          if (found.length === 0) return null;
          return (
            <section key={group.kind} className="rounded-panel border border-line bg-surface p-4">
              <h2 className="text-sm font-semibold text-ink-muted">
                {group.label} · {found.length}
              </h2>
              <ul className="mt-2 space-y-2">
                {found.map((hit, index) => (
                  <li key={`${hit.kind}-${hit.ref}-${hit.organizationId}-${index}`}>
                    <Link
                      href={hrefFor(hit)}
                      className="tap-row flex items-center gap-3 rounded-control border border-line bg-raised px-3 py-2.5"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{hit.title}</span>
                        <span className="mt-0.5 block truncate text-xs text-ink-muted">
                          {[hit.organizationName, hit.detail.replace(/_/g, " ")].filter(Boolean).join(" · ")}
                        </span>
                        {hit.at ? (
                          <span className="mt-0.5 block text-xs text-ink-faint">
                            <AdminTime iso={hit.at} timeZone={zones.get(hit.organizationId) ?? ""} dateOnly />
                          </span>
                        ) : null}
                      </span>
                      <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          );
        })
      )}
    </div>
  );
}
