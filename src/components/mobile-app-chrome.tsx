"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  FolderOpen,
  Home,
  Menu,
  MoreHorizontal,
  Plus,
  PlugZap,
  ReceiptText,
  Route,
  Search,
  Settings,
  UserRound,
  UsersRound,
  X,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { pilotJobs } from "@/lib/pilot-data";
import { AccountMenu } from "@/components/account-menu";

type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

const menuItems: NavItem[] = [
  { label: "Dashboard", href: "/", icon: Home, description: "Today’s business overview" },
  { label: "Full schedule", href: "/schedule", icon: CalendarDays, description: "Calendar and every job" },
  { label: "Jobs", href: "/schedule?view=jobs", icon: BriefcaseBusiness, description: "Open and upcoming work" },
  { label: "Customers", href: "/search?scope=customers", icon: UsersRound, description: "Customer and property records" },
  { label: "Invoices", href: "/invoices", icon: ReceiptText, description: "Paid, unpaid, and overdue" },
  { label: "Files", href: "/files", icon: FolderOpen, description: "Job documents and cloud sync" },
  { label: "Materials", href: "/materials", icon: Boxes, description: "Needs, truck stock, and sourcing" },
  { label: "Route builder", href: "/route", icon: Route, description: "Optimize before opening maps" },
  { label: "Supplier connections", href: "/settings/integrations", icon: PlugZap, description: "Lowe’s and Home Depot programs" },
  { label: "Account settings", href: "/account", icon: Settings, description: "Profile, premium, app, and Square" },
];

const bottomItems = [
  { label: "Home", href: "/", icon: Home },
  { label: "Jobs", href: "/schedule?view=jobs", icon: BriefcaseBusiness },
  { label: "New", href: "/#new-job", icon: Plus, primary: true },
  { label: "Customers", href: "/search?scope=customers", icon: UserRound },
  { label: "More", href: "/search", icon: MoreHorizontal },
];

function Brand() {
  return (
    <Link href="/" className="flex min-h-11 items-center gap-2 text-white" aria-label="Volterra dashboard">
      <Zap className="h-7 w-7 fill-[#ffbf18] text-[#ffbf18]" aria-hidden />
      <span className="text-lg font-bold">VOLTERRA</span>
    </Link>
  );
}

export function MobileAppChrome({
  title,
  backHref,
  active = "Home",
}: {
  title?: string;
  backHref?: string;
  active?: string;
}) {
  const [searchOpen, setSearchOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [query, setQuery] = useState("");

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
      icon: BriefcaseBusiness,
    }));
    const allResults = [...jobResults, ...menuItems];
    if (!normalized) return allResults.slice(0, 8);
    return allResults.filter((item) =>
      `${item.label} ${item.description}`.toLowerCase().includes(normalized),
    );
  }, [query]);

  return (
    <>
      <header className="sticky top-0 z-40 -mx-2 mb-3 flex min-h-14 items-center justify-between border-b border-white/10 bg-[#06131d]/95 px-3 py-1.5 text-white backdrop-blur lg:hidden">
        {backHref ? (
          <Link href={backHref} className="tap-target inline-flex min-w-0 items-center gap-2" aria-label={`Back to ${backHref === "/" ? "dashboard" : "previous page"}`}>
            <ArrowLeft className="h-5 w-5 shrink-0" aria-hidden />
            <span className="truncate text-sm font-semibold">{title}</span>
          </Link>
        ) : (
          <Brand />
        )}
        <div className="flex items-center gap-1.5">
          <button type="button" className="mobile-icon tap-target" aria-label="Search jobs and customers" onClick={() => setSearchOpen(true)}>
            <Search className="h-5 w-5" aria-hidden />
          </button>
          <AccountMenu />
          <button type="button" className="mobile-icon tap-target" aria-label="Open main menu" onClick={() => setMenuOpen(true)}>
            <Menu className="h-5 w-5" aria-hidden />
          </button>
        </div>
      </header>

      <nav className="fixed inset-x-3 bottom-3 z-50 flex min-h-[64px] items-end justify-around rounded-2xl border border-white/10 bg-[#081824]/96 px-1 pb-[max(8px,env(safe-area-inset-bottom))] pt-2 text-white shadow-2xl backdrop-blur lg:hidden" aria-label="Mobile navigation">
        {bottomItems.map(({ label, href, icon: Icon, primary }) => (
          <Link key={label} href={href} className={`tap-target flex min-w-[54px] flex-col items-center justify-center gap-0.5 rounded-xl text-[9px] ${active === label ? "text-[#ffc21c]" : "text-slate-400"}`}>
            <span className={primary ? "-mt-7 grid h-12 w-12 place-items-center rounded-full bg-[#ffc21c] text-[#071723] shadow-lg shadow-yellow-500/20" : "grid h-7 place-items-center"}>
              <Icon className={primary ? "h-6 w-6" : "h-5 w-5"} aria-hidden />
            </span>
            <span>{label}</span>
          </Link>
        ))}
      </nav>

      {searchOpen ? (
        <div className="fixed inset-0 z-[70] bg-[#041019]/96 p-3 text-white backdrop-blur-sm lg:hidden" role="dialog" aria-modal="true" aria-label="Search">
          <div className="mx-auto max-w-lg">
            <div className="flex items-center gap-2">
              <label className="flex min-h-12 flex-1 items-center gap-3 rounded-2xl border border-white/10 bg-[#0d202d] px-4">
                <Search className="h-5 w-5 text-slate-400" aria-hidden />
                <span className="sr-only">Search jobs, customers, addresses, and materials</span>
                <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search jobs, people, addresses…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500" />
              </label>
              <button type="button" onClick={() => setSearchOpen(false)} className="tap-target grid h-12 w-12 place-items-center rounded-2xl border border-white/10 bg-[#0d202d]" aria-label="Close search">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mb-2 mt-5 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Results</p>
            <div className="space-y-2">
              {results.map(({ label, description, href, icon: Icon }) => (
                <Link key={`${href}-${label}`} href={href} onClick={() => setSearchOpen(false)} className="flex min-h-16 items-center gap-3 rounded-2xl border border-white/10 bg-[#0b1b27] px-4 py-3 active:bg-[#122733]">
                  <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/5 text-[#ffc21c]"><Icon className="h-5 w-5" aria-hidden /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{label}</span><span className="mt-0.5 block truncate text-xs text-slate-400">{description}</span></span>
                </Link>
              ))}
              {results.length === 0 ? <p className="rounded-2xl border border-white/10 p-5 text-sm text-slate-400">No matches yet. Try a customer name, job number, city, or work type.</p> : null}
            </div>
          </div>
        </div>
      ) : null}

      {menuOpen ? (
        <div className="fixed inset-0 z-[70] bg-black/60 lg:hidden" role="dialog" aria-modal="true" aria-label="Main menu" onClick={() => setMenuOpen(false)}>
          <div className="ml-auto flex h-full w-[88%] max-w-sm flex-col bg-[#071723] p-4 text-white shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between"><Brand /><button type="button" onClick={() => setMenuOpen(false)} className="tap-target grid h-11 w-11 place-items-center rounded-xl border border-white/10" aria-label="Close menu"><X className="h-5 w-5" aria-hidden /></button></div>
            <p className="mb-3 mt-7 text-xs font-semibold uppercase tracking-[0.12em] text-slate-500">Run the business</p>
            <nav className="space-y-2" aria-label="Main menu links">
              {menuItems.map(({ label, href, icon: Icon, description }) => (
                <Link key={href} href={href} onClick={() => setMenuOpen(false)} className="flex min-h-14 items-center gap-3 rounded-2xl border border-white/8 bg-white/[0.03] px-3 py-2 active:bg-white/10">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 text-[#ffc21c]"><Icon className="h-[18px] w-[18px]" aria-hidden /></span>
                  <span className="min-w-0"><span className="block text-sm font-semibold">{label}</span><span className="block truncate text-[11px] text-slate-400">{description}</span></span>
                </Link>
              ))}
            </nav>
          </div>
        </div>
      ) : null}
    </>
  );
}
