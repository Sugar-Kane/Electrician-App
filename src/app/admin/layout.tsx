import { notFound } from "next/navigation";
import Link from "next/link";
import { ShieldCheck } from "lucide-react";

import { isPlatformAdmin } from "@/lib/admin-console";

/**
 * The gate on the whole console.
 *
 * Answers 404 rather than 403 for anyone who is not an admin: a signed-in
 * electrician poking at /admin should learn nothing, and "forbidden" confirms
 * there is something there to be forbidden from.
 *
 * This is a convenience, not the security boundary. Every function underneath
 * refuses independently in the database, so a missed check here would be a
 * cosmetic bug rather than a way in.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isPlatformAdmin())) notFound();

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
              </p>
            </div>
          </div>
          <nav className="flex flex-wrap gap-2 text-sm">
            <Link href="/admin" className="tap-target rounded-chip border border-line px-3 py-2 font-semibold">
              Businesses
            </Link>
            <Link href="/admin/users" className="tap-target rounded-chip border border-line px-3 py-2 font-semibold">
              People
            </Link>
            <Link href="/admin/audit" className="tap-target rounded-chip border border-line px-3 py-2 font-semibold">
              Activity
            </Link>
            <Link href="/" className="tap-target rounded-chip border border-line px-3 py-2 font-semibold">
              Exit
            </Link>
          </nav>
        </header>

        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}
