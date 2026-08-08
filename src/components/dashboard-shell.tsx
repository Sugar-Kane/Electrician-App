import Link from "next/link";
import {
  Bell,
  CalendarDays,
  Camera,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  FileCheck2,
  Navigation,
  PackageOpen,
  Plus,
  Route,
  Search,
  Send,
  ShieldCheck,
  WandSparkles,
  Wrench,
  Zap,
} from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { MobileAppChrome } from "@/components/mobile-app-chrome";
import { AccountMenu } from "@/components/account-menu";
import type {
  DashboardMetric,
  DashboardSnapshot,
  TechnicianMarker,
} from "@/lib/dashboard";


function Sparkline({ values, large = false }: { values: number[]; large?: boolean }) {
  const max = Math.max(...values);
  const min = Math.min(...values);
  const width = large ? 250 : 92;
  const height = large ? 72 : 42;
  const points = values
    .map((value, index) => {
      const x = (index / Math.max(1, values.length - 1)) * width;
      const y = height - ((value - min) / Math.max(1, max - min)) * (height - 8) - 4;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={large ? "h-[72px] w-full" : "h-11 w-24"}
      role="img"
      aria-label="Positive trend"
    >
      <defs>
        <linearGradient id={`chart-${large ? "large" : "small"}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#32a852" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#32a852" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#chart-${large ? "large" : "small"})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke="#31a653"
        strokeWidth={large ? 2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricCard({ metric, href }: { metric: DashboardMetric; href: string }) {
  return (
    <Link href={href} className="panel metric-card tap-card block min-w-[180px] p-4" aria-label={`${metric.label}: ${metric.value}. Open details`}>
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-slate-500">
        {metric.label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-[26px] font-semibold leading-none tracking-[-0.03em]">
            {metric.value}
          </p>
          <p
            className={`mt-2 text-xs ${
              metric.tone === "positive"
                ? "text-emerald-600"
                : metric.tone === "danger"
                  ? "text-red-500"
                  : "text-slate-500"
            }`}
          >
            {metric.detail}
          </p>
        </div>
        {metric.chart ? <Sparkline values={metric.chart} /> : null}
      </div>
    </Link>
  );
}

function Header({
  ownerName,
  source,
  timeZone,
}: {
  ownerName: string;
  source: DashboardSnapshot["source"];
  timeZone: string;
}) {
  // The business's day and hour, not the server's — production runs in UTC,
  // which would wish a Pacific crew good morning at 5pm and date the page a
  // day ahead of the schedule.
  const now = new Date();
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(now);
  const hour = Number(
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hour12: false }).format(now),
  );
  const greeting = hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";

  return (
    <header className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5">
          <Zap className="h-7 w-7 fill-[#ffbf18] text-[#ffbf18]" aria-hidden />
          <h1 className="text-[26px] font-semibold tracking-[-0.035em]">
            {greeting}, {ownerName}
          </h1>
        </div>
        <div className="mt-1 flex items-center gap-2 pl-10 text-xs text-slate-500">
          <span>{dateLabel}</span>
          <span aria-hidden>•</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            {source === "supabase" ? "Live business data" : "Pilot workspace"}
          </span>
        </div>
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <Link
          href="#new-job"
          className="hidden h-10 items-center gap-2 rounded-xl bg-[#071723] px-4 text-sm font-semibold text-white shadow-lg transition hover:-translate-y-0.5 sm:flex"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New
        </Link>
        <Link href="/search" className="icon-button" aria-label="Search">
          <Search className="h-4 w-4" aria-hidden />
        </Link>
        <Link href="/search?scope=notifications" className="icon-button relative" aria-label="Notifications">
          <Bell className="h-4 w-4" aria-hidden />
          <span className="absolute right-1 top-1 grid h-4 min-w-4 place-items-center rounded-full bg-[#ffca28] px-1 text-[9px] font-bold text-slate-950">
            3
          </span>
        </Link>
        <AccountMenu tone="light" />
      </div>
    </header>
  );
}

function SchedulePanel({ schedule }: Pick<DashboardSnapshot, "schedule">) {
  const statusStyles = {
    "In progress": "bg-blue-50 text-blue-600",
    Scheduled: "bg-amber-50 text-amber-700",
    Pending: "bg-slate-100 text-slate-600",
  };

  return (
    <section id="schedule" className="panel min-w-0 p-4">
      <div className="panel-heading">
        <h2>Today’s schedule</h2>
        <Link href="/schedule" className="panel-link tap-target">
          View full schedule <ChevronRight className="h-3 w-3" aria-hidden />
        </Link>
      </div>
      <div className="mt-2 divide-y divide-slate-100">
        {schedule.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
            <CalendarDays className="h-7 w-7 text-slate-300" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-slate-700">No jobs scheduled yet</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-slate-500">Your first paid diagnostic will appear here.</p>
            <Link href="/search?scope=intake" className="tap-target mt-3 inline-flex items-center text-xs font-semibold text-blue-600">Start an intake <ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>
          </div>
        ) : schedule.map((item) => (
          <Link key={item.id} href={`/jobs/${item.id}`} className="tap-row grid grid-cols-[64px_1fr_auto] items-center gap-3 py-3" aria-label={`Open job ${item.id} for ${item.customer}`}>
            <time className="self-start pt-1 text-[11px] font-semibold text-blue-600">
              {item.time}
            </time>
            <div className="relative border-l border-slate-200 pl-4 before:absolute before:-left-[3px] before:top-1.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-slate-300">
              <p className="text-sm font-semibold">{item.customer}</p>
              <p className="mt-0.5 text-[11px] text-slate-600">{item.summary}</p>
              <p className="text-[10px] text-slate-400">{item.city}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className={`rounded-md px-2 py-1 text-[9px] font-semibold ${statusStyles[item.status]}`}>
                {item.status}
              </span>
              <span className="grid h-8 w-8 place-items-center rounded-full bg-[#163044] text-[10px] font-bold text-white ring-2 ring-white">
                {item.technician}
              </span>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}

function TechnicianPin({ technician }: { technician: TechnicianMarker }) {
  const ring =
    technician.status === "active"
      ? "ring-emerald-500"
      : technician.status === "traveling"
        ? "ring-[#ffbc18]"
        : "ring-slate-400";

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${technician.x}%`, top: `${technician.y}%` }}
      title={`${technician.name} · ${technician.status}`}
    >
      <span className={`grid h-9 w-9 place-items-center rounded-full bg-[#102636] text-[10px] font-bold text-white shadow-lg ring-3 ${ring}`}>
        {technician.initials}
      </span>
    </div>
  );
}

function LiveMap({ technicians, source }: Pick<DashboardSnapshot, "technicians" | "source">) {
  return (
    <section className="panel min-w-0 overflow-hidden p-4">
      <div className="panel-heading">
        <div>
          <h2>Live route</h2>
          <p className="mt-1 text-[11px] text-slate-500">{technicians.length} {technicians.length === 1 ? "technician" : "technicians"} · Central Coast</p>
        </div>
        <Link href="/route" className="tap-target inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-[10px] font-semibold text-emerald-700"><Route className="h-3 w-3" aria-hidden /> Build route</Link>
      </div>
      <div className="route-map relative mt-3 h-[246px] overflow-hidden rounded-xl border border-slate-200">
        <svg viewBox="0 0 500 260" className="absolute inset-0 h-full w-full" aria-hidden>
          <path d="M-20 205 C80 180 95 105 170 130 S285 215 350 150 S410 55 530 90" fill="none" stroke="#9fc2de" strokeWidth="16" opacity=".55" />
          <path d="M-20 205 C80 180 95 105 170 130 S285 215 350 150 S410 55 530 90" fill="none" stroke="#eef8ff" strokeWidth="7" opacity=".9" />
          <path d="M20 72 C120 115 210 58 272 92 S386 210 505 189" fill="none" stroke="#e4c66c" strokeWidth="3" />
          <path d="M90 -10 C98 70 132 135 116 270" fill="none" stroke="#f1d78c" strokeWidth="3" />
          <path d="M350 -20 C310 70 329 157 418 280" fill="none" stroke="#e6d293" strokeWidth="3" />
        </svg>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[11px] font-bold tracking-[0.18em] text-slate-500">NIPOMO</p>
          <span className="mt-1 inline-block h-3 w-3 rounded-full border-2 border-white bg-blue-500 shadow-[0_0_0_5px_rgba(59,130,246,.18)]" />
        </div>
        {technicians.map((technician) => (
          <TechnicianPin key={technician.name} technician={technician} />
        ))}
        <div className="absolute bottom-3 left-3 rounded-lg border border-white/80 bg-white/90 px-2.5 py-2 text-[10px] text-slate-600 shadow-sm backdrop-blur">
          {source === "demo" ? <><span className="font-semibold text-slate-900">42 min</span> drive time saved today</> : <span className="font-semibold text-slate-900">Route optimization ready</span>}
        </div>
        <div className="absolute right-3 top-3 space-y-1.5">
          <Link href="/route" className="map-control tap-target" aria-label="Open route builder">
            <Navigation className="h-4 w-4" aria-hidden />
          </Link>
          <Link href="/route" className="map-control tap-target" aria-label="Open route options">
            <Route className="h-4 w-4" aria-hidden />
          </Link>
        </div>
      </div>
    </section>
  );
}

const aiActions = [
  { label: "Create estimate from photos", icon: Camera, href: "/search?scope=estimates" },
  { label: "Start diagnostic intake", icon: Wrench, href: "/search?scope=intake" },
  { label: "Check a code requirement", icon: ShieldCheck, href: "/search?scope=code" },
  { label: "Generate an invoice", icon: FileCheck2, href: "/invoices" },
];

function AiAssistant() {
  return (
    <section id="assistant" className="panel min-w-0 p-4">
      <div className="panel-heading">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 fill-[#ffb800] text-[#ffb800]" aria-hidden />
          <h2>AI assistant</h2>
        </div>
        <ChevronRight className="h-4 w-4 text-slate-400" aria-hidden />
      </div>
      <p className="mt-5 text-xs text-slate-600">How can I help you today?</p>
      <div className="mt-3 space-y-2">
        {aiActions.map(({ label, icon: Icon, href }) => (
          <Link key={label} href={href} className="ai-action tap-target">
            <Icon className="h-3.5 w-3.5" strokeWidth={1.8} aria-hidden />
            <span>{label}</span>
            <ChevronRight className="ml-auto h-3 w-3 text-slate-400" aria-hidden />
          </Link>
        ))}
      </div>
      <form className="mt-5 flex items-center gap-2" action="/search">
        <label htmlFor="assistant-question" className="sr-only">
          Ask the AI assistant
        </label>
        <input id="assistant-question" name="query" placeholder="Ask anything…" className="assistant-input" />
        <button type="submit" className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-[#102438] text-white" aria-label="Send question">
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </section>
  );
}

function InvoiceOverview({ invoiceAging, outstandingValue }: Pick<DashboardSnapshot, "invoiceAging"> & { outstandingValue: string }) {
  return (
    <Link href="/invoices?status=unpaid" id="invoices" className="panel tap-card block p-4" aria-label="Open unpaid invoices">
      <div className="panel-heading">
        <h2>Invoices overview</h2>
        <CircleDollarSign className="h-4 w-4 text-slate-400" aria-hidden />
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{outstandingValue}</p>
      <p className="text-[10px] text-slate-500">Outstanding</p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-slate-100">
        {invoiceAging.map((item, index) => (
          <span
            key={item.label}
            style={{ width: `${item.percent}%` }}
            className={index === 0 ? "bg-orange-500" : index === 1 ? "bg-amber-400" : "bg-yellow-300"}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {invoiceAging.map((item) => (
          <div key={item.label}>
            <p className="text-xs font-semibold">{item.value}</p>
            <p className="text-[9px] text-slate-500">{item.label}</p>
          </div>
        ))}
      </div>
    </Link>
  );
}

function ProfitOverview({ profit }: Pick<DashboardSnapshot, "profit">) {
  return (
    <Link href="/invoices?status=paid" id="reports" className="panel tap-card block p-4" aria-label="Open paid invoices and revenue">
      <div className="panel-heading">
        <h2>Profit overview</h2>
        <span className="text-[10px] text-slate-500">MTD</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tracking-tight">{profit.value}</p>
      <p className="text-[10px] font-medium text-emerald-600">{profit.change}</p>
      <div className="mt-2">
        <Sparkline values={profit.chart} large />
      </div>
    </Link>
  );
}

function InventoryOverview({ lowStock }: Pick<DashboardSnapshot, "lowStock">) {
  return (
    <section id="inventory" className="panel p-4">
      <div className="panel-heading">
        <h2>Inventory low stock</h2>
        <PackageOpen className="h-4 w-4 text-slate-400" aria-hidden />
      </div>
      <div className="mt-3 space-y-2.5">
        {lowStock.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">No low-stock items yet.</p> : lowStock.map((item) => (
          <Link key={item.name} href={`/materials?query=${encodeURIComponent(item.name)}`} className="tap-row flex min-h-11 items-center justify-between gap-3 rounded-xl px-2 text-xs">
            <span className="truncate text-slate-700">{item.name}</span>
            <span className="shrink-0 font-semibold text-amber-600">
              {item.quantity} {item.unit}
            </span>
          </Link>
        ))}
      </div>
      <Link href="/materials" className="tap-target mt-2 flex items-center justify-center gap-1 text-[10px] font-semibold text-blue-600">
        View all inventory <ChevronRight className="h-3 w-3" aria-hidden />
      </Link>
    </section>
  );
}

function RecentActivity({ activity }: Pick<DashboardSnapshot, "activity">) {
  return (
    <section className="panel p-4">
      <div className="panel-heading">
        <h2>Recent activity</h2>
        <ClipboardCheck className="h-4 w-4 text-slate-400" aria-hidden />
      </div>
      <div className="mt-3 space-y-3">
        {activity.length === 0 ? <p className="py-6 text-center text-xs text-slate-500">Activity will appear as work is added.</p> : activity.map((item) => (
          <Link key={`${item.label}-${item.when}`} href={item.label.includes("Invoice") ? "/invoices" : item.label.includes("Job") ? "/jobs/1048" : "/search"} className="tap-row flex min-h-11 items-center gap-2 rounded-xl px-1 text-[11px]">
            <span className={`h-2 w-2 rounded-full border-2 ${item.tone === "danger" ? "border-red-500" : "border-slate-400"}`} />
            <span className="min-w-0 flex-1 truncate text-slate-700">{item.label}</span>
            <time className="shrink-0 text-[9px] text-slate-400">{item.when}</time>
          </Link>
        ))}
      </div>
    </section>
  );
}

export function DashboardShell({ snapshot }: { snapshot: DashboardSnapshot }) {
  const metricDestinations = [
    "/invoices?status=paid",
    "/schedule?view=jobs",
    "/route",
    "/search?scope=estimates",
    "/invoices?status=unpaid",
  ];

  return (
    <main id="dashboard" className="min-h-screen bg-[#06131d] p-2 sm:p-3">
      <MobileAppChrome active="Home" />
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppSidebar businessName={snapshot.businessName} ownerName={snapshot.ownerName} />
        <div className="dashboard-canvas min-w-0 rounded-[24px] bg-[#f5f7f9] p-4 shadow-2xl shadow-black/15 sm:p-6 lg:min-h-[calc(100vh-24px)] lg:p-7">
          <Header ownerName={snapshot.ownerName} source={snapshot.source} timeZone={snapshot.timezone} />

          <div
            className="metric-scroll mt-6 grid gap-3 overflow-x-auto pb-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffbf18] lg:grid-cols-5 lg:overflow-visible lg:pb-0"
            role="region"
            aria-label="Business metrics"
            tabIndex={0}
          >
            {snapshot.metrics.map((metric, index) => (
              <MetricCard key={metric.label} metric={metric} href={metricDestinations[index] ?? "/"} />
            ))}
          </div>

          <div className="mt-4 grid min-w-0 gap-3 xl:grid-cols-[1.1fr_1.2fr_.9fr]">
            <SchedulePanel schedule={snapshot.schedule} />
            <LiveMap technicians={snapshot.technicians} source={snapshot.source} />
            <AiAssistant />
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InvoiceOverview invoiceAging={snapshot.invoiceAging} outstandingValue={snapshot.metrics[4]?.value ?? "$0"} />
            <ProfitOverview profit={snapshot.profit} />
            <InventoryOverview lowStock={snapshot.lowStock} />
            <RecentActivity activity={snapshot.activity} />
          </div>

          <section id="new-job" className="mt-3 flex flex-col gap-3 rounded-2xl border border-[#f2c84b]/50 bg-[#fff9e7] px-5 py-4 text-slate-900 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-start gap-3">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#ffbf18] text-[#081824]">
                <WandSparkles className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <h2 className="text-sm font-semibold">Turn the next call into a paid visit</h2>
                <p className="mt-1 text-xs text-slate-600">Start adaptive intake, screen safety concerns, and offer the best diagnostic window.</p>
              </div>
            </div>
            <Link href={snapshot.businessSlug ? `/book/${snapshot.businessSlug}` : "/search?scope=intake"} className="tap-target inline-flex h-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-[#081824] px-4 text-xs font-semibold text-white">
              {snapshot.businessSlug ? "Preview booking page" : "Start AI intake"} <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </section>
        </div>
      </div>
    </main>
  );
}
