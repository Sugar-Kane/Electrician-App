"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BellRing,
  Bot,
  Boxes,
  BriefcaseBusiness,
  CalendarDays,
  ChartNoAxesCombined,
  ChevronRight,
  FileText,
  FolderOpen,
  Inbox as InboxIcon,
  LayoutDashboard,
  MessagesSquare,
  PlugZap,
  ReceiptText,
  Route,
  ScrollText,
  Settings,
  ShoppingCart,
  UsersRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

export type NavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  description: string;
};

/**
 * The one navigation list.
 *
 * The desktop sidebar and the mobile drawer both render this, so a destination
 * cannot exist in one menu and be missing from the other — which is how
 * /settings/legal ended up reachable only by typing the URL.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard, description: "Today’s business overview" },
  { label: "Schedule", href: "/schedule", icon: CalendarDays, description: "Calendar and every job" },
  { label: "Jobs", href: "/schedule?view=jobs", icon: BriefcaseBusiness, description: "Open and upcoming work" },
  { label: "Messages", href: "/messages", icon: MessagesSquare, description: "Texts with customers" },
  { label: "Booking requests", href: "/booking-requests", icon: InboxIcon, description: "What customers asked for by text" },
  { label: "Customers", href: "/search?scope=customers", icon: UsersRound, description: "Customer and property records" },
  { label: "Estimates", href: "/search?scope=estimates", icon: FileText, description: "Sent and pending estimates" },
  { label: "Invoices", href: "/invoices", icon: ReceiptText, description: "Paid, unpaid, and overdue" },
  { label: "Reports", href: "/invoices?status=paid", icon: ChartNoAxesCombined, description: "What has been collected" },
  { label: "Files", href: "/files", icon: FolderOpen, description: "Job documents and cloud sync" },
  { label: "Materials", href: "/materials", icon: Boxes, description: "Needs, truck stock, and sourcing" },
  { label: "Purchase orders", href: "/materials?view=orders", icon: ShoppingCart, description: "What is on order" },
  { label: "Route builder", href: "/route", icon: Route, description: "Optimize before opening maps" },
  { label: "AI assistant", href: "/#assistant", icon: Bot, description: "Intake, code checks, and drafts" },
];

/** Configuration, kept apart from the day-to-day work above. */
export const SETUP_NAV_ITEMS: NavItem[] = [
  { label: "Supplier connections", href: "/settings/integrations", icon: PlugZap, description: "Lowe’s and Home Depot programs" },
  { label: "Automatic messages", href: "/settings/messages", icon: MessagesSquare, description: "What gets texted, and when" },
  { label: "Booking alerts", href: "/settings/notifications", icon: BellRing, description: "Where a booked job reaches you" },
  { label: "Legal pages", href: "/settings/legal", icon: ScrollText, description: "Terms and privacy carriers read" },
  { label: "Account settings", href: "/account", icon: Settings, description: "Profile, timezone, premium, Square" },
];

export const ALL_NAV_ITEMS = [...NAV_ITEMS, ...SETUP_NAV_ITEMS];

/**
 * Which menu entry the current page belongs to.
 *
 * Matched on pathname alone: the query string picks a view within a page, and
 * highlighting nothing at all while someone is on /invoices?status=overdue
 * would be worse than highlighting Invoices. Ties go to the first entry, so
 * /schedule reads as Schedule rather than Jobs. Deeper paths fall back to their
 * parent, which is what puts /jobs/1045 on Schedule and
 * /messages/<id> on Messages.
 */
export function activeNavHref(pathname: string, items: NavItem[] = ALL_NAV_ITEMS): string | null {
  const candidates = items.map((item) => ({ href: item.href, path: item.href.split(/[?#]/)[0]! }));

  const exact = candidates.find((candidate) => candidate.path === pathname);
  if (exact) return exact.href;

  const nested = candidates
    .filter((candidate) => candidate.path !== "/" && pathname.startsWith(`${candidate.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
  if (nested) return nested.href;

  // A job or a thread opened from a list still belongs to that list.
  if (pathname.startsWith("/jobs/")) return "/schedule";
  return null;
}

function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5" aria-label="Volteira dashboard">
      <span className="flex h-10 w-8 items-center justify-center text-[#ffbf18]">
        <Zap className="h-9 w-9 fill-current" strokeWidth={1.5} aria-hidden />
      </span>
      <span className="text-xl font-bold">VOLTEIRA</span>
    </Link>
  );
}

/**
 * The left menu, on every signed-in page rather than only the dashboard.
 *
 * It highlights where you actually are. It used to hardcode the first entry,
 * so the menu claimed you were on the dashboard no matter which option you had
 * clicked.
 */
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

  const link = (item: NavItem) => {
    const Icon = item.icon;
    const current = item.href === active;
    return (
      <Link
        key={item.href}
        href={item.href}
        aria-current={current ? "page" : undefined}
        className={`group flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition ${
          current
            ? "bg-white/10 font-semibold text-[#ffc21c] shadow-inner shadow-white/5"
            : "text-slate-300 hover:bg-white/5 hover:text-white"
        }`}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.8} aria-hidden />
        <span>{item.label}</span>
      </Link>
    );
  };

  return (
    <aside className="hidden min-h-[calc(100vh-16px)] flex-col rounded-[24px] border border-white/10 bg-[#071723] px-3 py-5 text-white shadow-2xl shadow-black/20 lg:flex">
      <div className="px-3 pb-6">
        <Brand />
        <p className="mt-1 pl-[42px] text-[8px] font-semibold tracking-[0.12em] text-slate-400">
          ELECTRICAL BUSINESS MANAGEMENT
        </p>
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto" aria-label="Primary navigation">
        {NAV_ITEMS.map(link)}
        <p className="px-3 pb-1 pt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
          Setup
        </p>
        {SETUP_NAV_ITEMS.map(link)}
      </nav>

      <Link
        href="/account"
        className="tap-row mt-6 rounded-2xl border border-white/10 bg-[#0b1d2b] p-3"
        aria-label="Open account settings"
      >
        <div className="flex items-center gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-[#ffcb34] to-[#f7931d] text-sm font-bold text-[#071723]">
            {initials || "U"}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{ownerName ?? "Account"}</p>
            <p className="truncate text-[11px] text-slate-400">
              {businessName ?? "Profile, timezone, and billing"}
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
        </div>
      </Link>
    </aside>
  );
}
