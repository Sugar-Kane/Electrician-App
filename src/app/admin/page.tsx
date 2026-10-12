import type { Metadata } from "next";
import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { getMessagingEvidence, listOrganizations } from "@/lib/admin-console";
import { diagnose, headline } from "@/lib/admin-health";

export const metadata: Metadata = {
  title: "Businesses | Volteira support",
  robots: { index: false, follow: false },
};

const BADGE: Record<string, string> = {
  blocking: "border-critical/30 bg-critical-bg text-critical",
  degraded: "border-caution/25 bg-caution-bg text-caution",
  ok: "border-positive/25 bg-positive-bg text-positive",
  note: "border-line bg-white/5 text-ink-muted",
};

const FILTERS = [
  { value: "", label: "All" },
  { value: "attention", label: "Needs attention" },
  { value: "working", label: "Working" },
  { value: "archived", label: "Archived" },
] as const;

export default async function AdminOrganizationsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; show?: string }>;
}) {
  const [{ q = "", show = "" }, organizations, evidence] = await Promise.all([
    searchParams,
    listOrganizations(),
    getMessagingEvidence(null),
  ]);
  const query = q.trim().toLowerCase().slice(0, 80);
  const filter = FILTERS.some((entry) => entry.value === show) ? show : "";

  const rows = organizations.map((organization) => {
    const findings = diagnose({ ...organization, delivery: evidence.get(organization.id) });
    return { organization, verdict: headline(findings) };
  });
  const shown = rows.filter(({ organization, verdict }) => {
    if (query && ![organization.name, organization.city, organization.id].join(" ").toLowerCase().includes(query)) return false;
    if (filter === "archived") return organization.archived;
    if (organization.archived && filter) return false;
    if (filter === "attention") return verdict.severity === "blocking" || verdict.severity === "degraded";
    if (filter === "working") return verdict.severity === "ok";
    return true;
  });
  const href = (next: string) => {
    const params = new URLSearchParams({ ...(query ? { q: query } : {}), ...(next ? { show: next } : {}) });
    return params.size ? `/admin?${params.toString()}` : "/admin";
  };

  return (
    <div className="space-y-3">
      <form action="/admin" className="flex gap-2">
        {filter ? <input type="hidden" name="show" value={filter} /> : null}
        <label className="flex min-h-12 min-w-0 flex-1 items-center rounded-control border border-line bg-raised px-4">
          <span className="sr-only">Find a business</span>
          <input
            name="q"
            defaultValue={query}
            placeholder="Business name, city or id"
            className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint"
          />
        </label>
        <button className="tap-target shrink-0 rounded-control border border-line px-4 text-sm font-semibold">Find</button>
      </form>

      <nav aria-label="Filter businesses" className="flex flex-wrap gap-1.5">
        {FILTERS.map((entry) => (
          <Link
            key={entry.value}
            href={href(entry.value)}
            aria-current={entry.value === filter ? "page" : undefined}
            className={`tap-target inline-flex items-center rounded-chip px-3 text-xs font-semibold ${
              entry.value === filter ? "bg-brand text-on-brand" : "border border-line text-ink-muted hover:text-ink"
            }`}
          >
            {entry.label}
          </Link>
        ))}
      </nav>

      <p className="px-1 text-sm text-ink-muted">
        {shown.length === organizations.length
          ? `${organizations.length} ${organizations.length === 1 ? "business" : "businesses"}`
          : `${shown.length} of ${organizations.length} businesses`}
      </p>

      {shown.map(({ organization, verdict }) => {

        return (
          <Link
            key={organization.id}
            href={`/admin/organizations/${organization.id}`}
            className="tap-row block rounded-panel border border-line bg-surface p-5 transition hover:border-line-strong"
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-semibold">{organization.name}</h2>
                <p className="mt-1 truncate text-sm text-ink-muted">
                  {[organization.city, organization.state].filter(Boolean).join(", ") || "No address"}
                  {organization.phone ? ` · ${organization.phone}` : ""}
                </p>
              </div>
              <span
                className={`shrink-0 rounded-full border px-3 py-1 text-xs font-semibold ${BADGE[verdict.severity] ?? BADGE.note}`}
              >
                {verdict.label}
              </span>
            </div>

            <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-xs text-ink-faint">People</dt>
                <dd className="font-semibold">
                  {organization.memberCount}
                  {organization.pendingInvitations > 0 ? (
                    <span className="ml-1 text-xs font-normal text-caution">
                      +{organization.pendingInvitations} invited
                    </span>
                  ) : null}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Jobs</dt>
                <dd className="font-semibold">{organization.jobCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Bookings</dt>
                <dd className="font-semibold">{organization.bookingCount}</dd>
              </div>
              <div>
                <dt className="text-xs text-ink-faint">Last booking</dt>
                <dd className="font-semibold">
                  <AdminTime iso={organization.lastBookingAt} timeZone={organization.timeZone} dateOnly empty="never" />
                </dd>
              </div>
            </dl>
          </Link>
        );
      })}

      {shown.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface p-5 text-sm text-ink-muted">
          {organizations.length === 0 ? "No businesses yet." : "No business matches."}
        </p>
      ) : null}
    </div>
  );
}
