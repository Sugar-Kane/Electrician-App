import type { Metadata } from "next";
import Link from "next/link";

import { listOrganizations } from "@/lib/admin-console";
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

function when(iso: string): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export default async function AdminOrganizationsPage() {
  const organizations = await listOrganizations();

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-ink-muted">
        {organizations.length} {organizations.length === 1 ? "business" : "businesses"}
      </p>

      {organizations.map((organization) => {
        const findings = diagnose(organization);
        const verdict = headline(findings);

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
                <dd className="font-semibold">{when(organization.lastBookingAt)}</dd>
              </div>
            </dl>
          </Link>
        );
      })}

      {organizations.length === 0 ? (
        <p className="rounded-panel border border-line bg-surface p-5 text-sm text-ink-muted">
          No businesses yet.
        </p>
      ) : null}
    </div>
  );
}
