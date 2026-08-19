"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight, Zap } from "lucide-react";

import { NavIcon } from "@/components/ui/nav-icon";
import { NAV_SECTIONS, activeNavHref, type NavItem } from "@/lib/navigation";
import { scrollToTop } from "@/lib/scroll-top";

/**
 * The left menu.
 *
 * It renders NAV_SECTIONS and nothing of its own, so the desktop sidebar and
 * the mobile drawer cannot disagree about what exists — which is how
 * /settings/legal once ended up reachable only by typing the URL.
 */

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Volteira dashboard">
      <span className="flex h-10 w-8 items-center justify-center text-brand">
        <Zap className="h-9 w-9 fill-current" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="text-xl font-bold text-ink">VOLTEIRA</span>
    </Link>
  );
}

export function NavLink({ item, active }: { item: NavItem; active: boolean }) {
  return (
    <Link
      href={item.href}
      // Clicking the entry you are already on has nowhere to navigate to, so
      // the page stays wherever it was scrolled to. Going back to the top is
      // what the click meant.
      onClick={() => (active ? scrollToTop() : undefined)}
      aria-current={active ? "page" : undefined}
      className={`group flex items-center gap-3 rounded-chip px-3 py-2.5 text-sm transition ${
        active
          ? "bg-white/10 font-semibold text-brand"
          : "text-ink-muted hover:bg-white/5 hover:text-ink"
      }`}
    >
      <NavIcon name={item.icon} />
      <span>{item.label}</span>
    </Link>
  );
}

export function AppSidebar({
  businessName,
  ownerName,
}: {
  businessName?: string;
  ownerName?: string;
}) {
  const pathname = usePathname();
  const active = activeNavHref(pathname);

  const initials = (ownerName ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <aside className="hidden min-h-[calc(100vh-16px)] flex-col rounded-panel border border-line bg-sunken px-3 py-5 shadow-2xl shadow-black/20 lg:flex">
      <div className="px-3 pb-6">
        <Brand />
        <p className="mt-1 pl-[42px] text-[8px] font-semibold tracking-[0.12em] text-ink-faint">
          ELECTRICAL BUSINESS MANAGEMENT
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Primary navigation">
        {NAV_SECTIONS.map((section, index) => (
          <div key={section.title || `section-${index}`} className={index > 0 ? "pt-4" : ""}>
            {section.title ? (
              <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {section.title}
              </p>
            ) : null}
            {section.items.map((item) => (
              <NavLink key={item.href} item={item} active={item.href === active} />
            ))}
          </div>
        ))}
      </nav>

      <Link
        href="/account"
        className="tap-row mt-6 rounded-control border border-line bg-raised p-3"
        aria-label="Open account settings"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-brand text-sm font-bold text-on-brand">
            {initials || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-ink">{ownerName ?? "Account"}</p>
            <p className="truncate text-[11px] text-ink-muted">
              {businessName ?? "Profile and preferences"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden />
        </div>
      </Link>
    </aside>
  );
}
