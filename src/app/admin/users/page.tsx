import type { Metadata } from "next";
import Link from "next/link";
import { ShieldCheck, TriangleAlert } from "lucide-react";

import { listUsers } from "@/lib/admin-console";

export const metadata: Metadata = {
  title: "People | Volteira support",
  robots: { index: false, follow: false },
};

function when(iso: string): string {
  if (!iso) return "never";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "never";
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

/**
 * Everyone with an account.
 *
 * The row that matters is the one with no business: somebody who signed up,
 * never got an invitation, and is looking at an app with nothing in it. That is
 * the support call, so it is called out rather than left to be inferred from a
 * blank column.
 */
export default async function AdminUsersPage() {
  const users = await listUsers();

  return (
    <div className="space-y-3">
      <p className="px-1 text-sm text-ink-muted">
        {users.length} {users.length === 1 ? "account" : "accounts"}
      </p>

      {users.map((user) => (
        <div
          key={`${user.userId}-${user.organizationId}`}
          className="rounded-panel border border-line bg-surface p-5"
        >
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="flex items-center gap-2 truncate text-base font-semibold">
                {user.fullName || user.email}
                {user.isPlatformAdmin ? (
                  <ShieldCheck className="h-4 w-4 shrink-0 text-brand" aria-label="Platform admin" />
                ) : null}
              </h2>
              <p className="mt-1 truncate text-sm text-ink-muted">{user.email}</p>
            </div>

            {user.organizationId ? (
              <Link
                href={`/admin/organizations/${user.organizationId}`}
                className="tap-target shrink-0 rounded-chip border border-line px-3 py-2 text-xs font-semibold"
              >
                {user.organizationName} · {user.role}
              </Link>
            ) : (
              <span className="flex shrink-0 items-center gap-2 rounded-full border border-amber-300/25 bg-amber-300/[0.08] px-3 py-1 text-xs font-semibold text-amber-100">
                <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
                No business
              </span>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-xs text-ink-faint">Signed up</dt>
              <dd className="font-semibold">{when(user.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Last signed in</dt>
              <dd className="font-semibold">{when(user.lastSignInAt)}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink-faint">Email</dt>
              <dd className={`font-semibold ${user.emailConfirmed ? "" : "text-amber-200"}`}>
                {user.emailConfirmed ? "Confirmed" : "Not confirmed"}
              </dd>
            </div>
          </dl>
        </div>
      ))}
    </div>
  );
}
