import Link from "next/link";
import { IntentLink } from "@/components/intent-link";
import { Bell, MessageCircle, Plus, Search } from "lucide-react";

import { AccountMenu } from "@/components/account-menu";

/**
 * The desktop top bar's buttons, the same on every screen.
 *
 * New job, Search and the assistant are things done from anywhere, so they
 * live here once instead of in the left menu, where Search and Chat sat among
 * the places you go. The phone has its own copy of Search and Ask in its top
 * bar (mobile-app-chrome).
 */
export function TopActions({ notifications = false }: { notifications?: boolean }) {
  const button =
    "tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink";

  return (
    <div className="flex items-center gap-2">
      <Link
        href="/jobs/new"
        className="tap-target flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand transition hover:bg-brand-strong"
      >
        <Plus className="h-4 w-4" aria-hidden />
        New job
      </Link>
      <Link href="/search" className={button} aria-label="Search jobs and customers">
        <Search className="h-4 w-4" aria-hidden />
      </Link>
      <IntentLink
        href="/assistant"
        className="tap-target flex items-center gap-2 rounded-chip border border-line bg-raised px-3 text-sm font-semibold text-ink"
      >
        <MessageCircle className="h-4 w-4 text-brand" aria-hidden />
        Ask Volteira
      </IntentLink>
      {notifications ? (
        <Link href="/search?scope=notifications" className={button} aria-label="Notifications">
          <Bell className="h-4 w-4" aria-hidden />
        </Link>
      ) : null}
      <AccountMenu />
    </div>
  );
}
