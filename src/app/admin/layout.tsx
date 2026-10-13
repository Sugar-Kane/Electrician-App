import { ShieldCheck } from "lucide-react";

import { AdminNav } from "@/components/admin-nav";
import { myAdminRole, requirePlatformAdmin } from "@/lib/admin-console";

/**
 * The gate on the whole console.
 *
 * Answers 404 rather than 403 for anyone who is not an admin: a signed-in
 * electrician poking at /admin should learn nothing, and "forbidden" confirms
 * there is something there to be forbidden from.
 *
 * This is a convenience, not the security boundary. Every function underneath
 * refuses independently in the database, so a missed check here would be a
 * cosmetic bug rather than a way in. Each page asks too: a page renders beside
 * its layout, not inside this check.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requirePlatformAdmin();
  const role = await myAdminRole();

  return (
    <main className="min-h-screen bg-canvas px-3 py-4 pb-24 text-white sm:px-5 sm:py-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-panel border border-brand/25 bg-brand/[0.06] px-5 py-4">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand">
                Volteira support
              </p>
              <p className="text-sm text-ink-muted">
                Every business on the platform. Opening one is recorded.
                {role === "support" ? " Your support role can look and check, not change." : ""}
              </p>
            </div>
          </div>
          <AdminNav />
        </header>

        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
