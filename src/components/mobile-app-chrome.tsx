"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { CreateSheet } from "@/components/create-sheet";
import {
  ArrowLeft,
  CalendarDays,
  Home,
  Menu,
  MessagesSquare,
  MoreHorizontal,
  Plus,
  Search,
  X,
  Zap,
} from "lucide-react";

import { AccountMenu } from "@/components/account-menu";
import { NavIcon } from "@/components/ui/nav-icon";
import { ALL_NAV_ITEMS, NAV_SECTIONS, activeNavHref } from "@/lib/navigation";
import { pilotJobs } from "@/lib/pilot-data";

/**
 * The phone's chrome: a top bar, a bottom bar, search, and the full menu.
 *
 * Which entry is lit used to be a string each page passed in by hand, so a page
 * that forgot said "Home" while you were somewhere else entirely. It is now
 * derived from the URL, the same way the desktop sidebar does it — there is one
 * answer to "where am I" and both menus read it.
 */

/**
 * The five things under a thumb.
 *
 * "Schedule" is a software word for a screen an electrician thinks of as their
 * jobs. The centre is creation rather than a destination — see CreateSheet for
 * why it is no longer the assistant.
 */
const BOTTOM_ITEMS = [
  { label: "Home", href: "/", icon: Home },
  { label: "Jobs", href: "/schedule", icon: CalendarDays },
  { label: "New", href: "", icon: Plus, primary: true },
  { label: "Messages", href: "/messages", icon: MessagesSquare },
  { label: "More", href: "/settings", icon: MoreHorizontal },
];

function Brand() {
  return (
    <Link
      href="/"
      className="flex min-h-11 items-center gap-2 text-ink"
      aria-label="Volteira dashboard"
    >
      <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
      <span className="text-lg font-bold">VOLTEIRA</span>
    </Link>
  );
}

export function MobileAppChrome({ title, backHref }: { title?: string; backHref?: string }) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pathname = usePathname();
  const active = activeNavHref(pathname);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setSearchOpen(false);
        setMenuOpen(false);
      }
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, []);

  const results = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const jobResults = pilotJobs.map((job) => ({
      label: `${job.customer} · #${job.id}`,
      description: `${job.workType} · ${job.address}, ${job.city}`,
      href: `/jobs/${job.id}`,
      icon: "CalendarDays",
    }));
    const navResults = ALL_NAV_ITEMS.map((item) => ({
      label: item.label,
      description: item.description,
      href: item.href,
      icon: item.icon,
    }));
    const all = [...jobResults, ...navResults];
    if (!normalized) return all.slice(0, 8);
    return all.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  return (
    <>
      <header className="sticky top-0 z-40 -mx-2 mb-3 flex min-h-14 items-center justify-between border-b border-line bg-canvas/95 px-3 py-1.5 backdrop-blur lg:hidden">
        {backHref ? (
          <Link
            href={backHref}
            className="tap-target inline-flex min-w-0 items-center gap-2 text-ink"
            aria-label={`Back to ${backHref === "/" ? "dashboard" : "previous page"}`}
          >
            <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate text-sm font-semibold">{title}</span>
          </Link>
        ) : (
          <Brand />
        )}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink"
            aria-label="Search jobs and customers"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="h-5 w-5" aria-hidden />
          </button>
          <AccountMenu />
          <button
            type="button"
            className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink"
            aria-label="Open main menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <nav
        className="fixed inset-x-3 bottom-3 z-50 flex min-h-[64px] items-end justify-around rounded-control border border-line bg-sunken/96 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 shadow-2xl backdrop-blur lg:hidden"
        aria-label="Mobile navigation"
      >
        {BOTTOM_ITEMS.map(({ label, href, icon: Icon, primary }) => {
          const current = !primary && activeNavHref(href) === active && active !== null;

          const shell = `tap-target flex min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-chip text-[10px] ${
            current ? "text-brand" : "text-ink-muted"
          }`;

          const inner = (
            <>
              <span
                className={
                  primary
                    ? "-mt-7 grid h-12 w-12 place-items-center rounded-full bg-brand text-on-brand shadow-lg shadow-yellow-500/20"
                    : "grid h-7 place-items-center"
                }
              >
                <Icon className={primary ? "h-6 w-6" : "h-5 w-5"} aria-hidden />
              </span>
              <span>{label}</span>
            </>
          );

          // The centre opens a sheet rather than navigating, so it is a button.
          // A link to "" would quietly take somebody to the dashboard.
          if (primary) {
            return (
              <button
                key={label}
                type="button"
                onClick={() => setCreateOpen(true)}
                aria-haspopup="dialog"
                aria-expanded={createOpen}
                aria-label="Create"
                className={shell}
              >
                {inner}
              </button>
            );
          }

          return (
            <Link
              key={label}
              href={href}
              aria-current={current ? "page" : undefined}
              className={shell}
            >
              {inner}
            </Link>
          );
        })}
      </nav>

      <CreateSheet open={createOpen} onClose={() => setCreateOpen(false)} />

      {searchOpen ? (
        <div
          className="fixed inset-0 z-[70] bg-canvas/96 p-3 backdrop-blur-sm lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Search"
        >
          <div className="mx-auto max-w-lg">
            <div className="flex items-center gap-2">
              <label className="flex min-h-12 flex-1 items-center gap-3 rounded-control border border-line bg-raised px-4">
                <Search className="h-5 w-5 text-ink-muted" aria-hidden />
                <span className="sr-only">Search jobs, customers, addresses, and materials</span>
                <input
                  autoFocus
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search jobs, people, addresses…"
                  className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint"
                />
              </label>
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                className="tap-target grid h-12 w-12 place-items-center rounded-control border border-line bg-raised"
                aria-label="Close search"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
              Results
            </p>
            <div className="space-y-2">
              {results.map(({ label, description, href, icon }) => (
                <Link
                  key={`${href}-${label}`}
                  href={href}
                  onClick={() => setSearchOpen(false)}
                  className="flex min-h-16 items-center gap-3 rounded-control border border-line bg-surface px-4 py-3 active:bg-raised"
                >
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-chip bg-white/5 text-brand">
                    <NavIcon name={icon} className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-ink">{label}</span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {description}
                    </span>
                  </span>
                </Link>
              ))}
              {results.length === 0 ? (
                <p className="rounded-control border border-line p-5 text-sm text-ink-muted">
                  No matches yet. Try a customer name, job number, city, or work type.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {menuOpen ? (
        <div
          className="fixed inset-0 z-[70] bg-black/60 lg:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Main menu"
          onClick={() => setMenuOpen(false)}
        >
          <div
            className="ml-auto flex h-full w-[88%] max-w-sm flex-col overflow-y-auto bg-sunken p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <Brand />
              <button
                type="button"
                onClick={() => setMenuOpen(false)}
                className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line"
                aria-label="Close menu"
              >
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>

            <nav className="mt-6 space-y-4" aria-label="Main menu links">
              {NAV_SECTIONS.map((section, index) => (
                <div key={section.title || `section-${index}`}>
                  {section.title ? (
                    <p className="mb-2 px-1 text-xs font-semibold uppercase tracking-[0.12em] text-ink-faint">
                      {section.title}
                    </p>
                  ) : null}
                  <div className="space-y-2">
                    {section.items.map((item) => (
                      <Link
                        key={item.href}
                        href={item.href}
                        onClick={() => setMenuOpen(false)}
                        aria-current={item.href === active ? "page" : undefined}
                        className={`flex min-h-14 items-center gap-3 rounded-control border px-3 py-2 active:bg-white/10 ${
                          item.href === active
                            ? "border-brand/40 bg-brand/[0.08]"
                            : "border-line bg-white/[0.03]"
                        }`}
                      >
                        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-white/5 text-brand">
                          <NavIcon name={item.icon} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-ink">{item.label}</span>
                          <span className="block truncate text-[11px] text-ink-muted">
                            {item.description}
                          </span>
                        </span>
                      </Link>
                    ))}
                  </div>
                </div>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
