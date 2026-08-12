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
import type { DashboardMetric, DashboardSnapshot, TechnicianMarker } from "@/lib/dashboard";
import { NeedsAttention, NextJobCard, TodaysJobs } from "@/components/dashboard-today";
import { todayInZone } from "@/lib/calendar";
import {
  canceledToday,
  nextJob,
  todaysJobs,
  type AttentionItem,
} from "@/lib/dashboard-focus";
import type { PilotJob } from "@/lib/pilot-data";

/**
 * The dashboard.
 *
 * It used to be the odd one out: a light canvas with white panels on desktop,
 * repainted dark below 1024px by a block of descendant overrides in the global
 * stylesheet. So it was one theme on a laptop, another on a phone, and neither
 * matched the page you reached by clicking anything in the menu.
 *
 * It is now the same dark surface as everywhere else, built from the same
 * tokens, and the override block is deleted rather than maintained.
 */

/** A panel. The same shape the rest of the app uses. */
function Panel({
  children,
  className = "",
  id,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section
      id={id}
      className={`rounded-panel border border-line bg-surface p-4 ${className}`}
    >
      {children}
    </section>
  );
}

function PanelHeading({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-sm font-semibold tracking-tight text-ink">{title}</h2>
      {action}
    </div>
  );
}

function PanelLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="tap-target inline-flex items-center gap-1 text-[10px] font-semibold text-info"
    >
      {children}
    </Link>
  );
}

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
          <stop offset="0%" stopColor="var(--color-positive)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--color-positive)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points} ${width},${height}`}
        fill={`url(#chart-${large ? "large" : "small"})`}
      />
      <polyline
        points={points}
        fill="none"
        stroke="var(--color-positive)"
        strokeWidth={large ? 2 : 1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function MetricCard({ metric, href }: { metric: DashboardMetric; href: string }) {
  return (
    <Link
      href={href}
      className="tap-card block min-h-[112px] min-w-[180px] rounded-control border border-line bg-surface p-4"
      aria-label={`${metric.label}: ${metric.value}. Open details`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted">
        {metric.label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <div>
          <p className="text-[26px] font-semibold leading-none tracking-[-0.03em] text-ink">
            {metric.value}
          </p>
          <p
            className={`mt-2 text-xs ${
              metric.tone === "positive"
                ? "text-positive"
                : metric.tone === "danger"
                  ? "text-critical"
                  : "text-ink-muted"
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
          <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink">
            {greeting}, {ownerName}
          </h1>
        </div>
        <div className="mt-1 flex items-center gap-2 pl-10 text-xs text-ink-muted">
          <span>{dateLabel}</span>
          <span aria-hidden>•</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-positive" />
            {source === "supabase" ? "Live business data" : "Pilot workspace"}
          </span>
        </div>
      </div>
      <div className="hidden items-center gap-2 lg:flex">
        <Link
          href="#new-job"
          className="tap-target hidden items-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand transition hover:bg-brand-strong sm:flex"
        >
          <Plus className="h-4 w-4" aria-hidden />
          New
        </Link>
        <Link
          href="/search"
          className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink"
          aria-label="Search"
        >
          <Search className="h-4 w-4" aria-hidden />
        </Link>
        {/* No badge: the "3" that used to sit here was a constant, so it
            never went away however many notifications had been read. */}
        <Link
          href="/search?scope=notifications"
          className="tap-target grid h-11 w-11 place-items-center rounded-chip border border-line bg-raised text-ink"
          aria-label="Notifications"
        >
          <Bell className="h-4 w-4" aria-hidden />
        </Link>
        <AccountMenu />
      </div>
    </header>
  );
}

function SchedulePanel({ schedule }: Pick<DashboardSnapshot, "schedule">) {
  const statusStyles = {
    "In progress": "bg-info-bg text-info",
    Scheduled: "bg-caution-bg text-caution",
    Pending: "bg-white/5 text-ink-muted",
    Canceled: "bg-critical-bg text-critical",
  };

  return (
    <Panel id="schedule" className="min-w-0">
      <PanelHeading
        title="Today’s schedule"
        action={
          <PanelLink href="/schedule">
            View full schedule <ChevronRight className="h-3 w-3" aria-hidden />
          </PanelLink>
        }
      />
      <div className="mt-2 divide-y divide-[color:var(--color-line)]">
        {schedule.length === 0 ? (
          <div className="flex min-h-40 flex-col items-center justify-center px-4 text-center">
            <CalendarDays className="h-7 w-7 text-ink-faint" aria-hidden />
            <p className="mt-3 text-sm font-semibold text-ink">No jobs scheduled yet</p>
            <p className="mt-1 max-w-xs text-xs leading-5 text-ink-muted">
              Your first paid diagnostic will appear here.
            </p>
            <Link
              href="/search?scope=intake"
              className="tap-target mt-3 inline-flex items-center text-xs font-semibold text-info"
            >
              Start an intake <ChevronRight className="h-3.5 w-3.5" aria-hidden />
            </Link>
          </div>
        ) : (
          schedule.map((item) => (
            <Link
              key={item.id}
              href={`/jobs/${item.id}`}
              className="tap-row grid grid-cols-[64px_1fr_auto] items-center gap-3 py-3"
              aria-label={`Open job ${item.id} for ${item.customer}`}
            >
              <time className="self-start pt-1 text-[11px] font-semibold text-info">
                {item.time}
              </time>
              <div className="relative border-l border-line pl-4 before:absolute before:-left-[3px] before:top-1.5 before:h-1.5 before:w-1.5 before:rounded-full before:bg-ink-faint">
                <p className="text-sm font-semibold text-ink">{item.customer}</p>
                <p className="mt-0.5 text-[11px] text-ink-muted">{item.summary}</p>
                <p className="text-[10px] text-ink-faint">{item.city}</p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-chip px-2 py-1 text-[9px] font-semibold ${statusStyles[item.status]}`}
                >
                  {item.status}
                </span>
                <span className="grid h-8 w-8 place-items-center rounded-full bg-raised text-[10px] font-bold text-ink ring-1 ring-line-strong">
                  {item.technician}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>
    </Panel>
  );
}

function TechnicianPin({ technician }: { technician: TechnicianMarker }) {
  const ring =
    technician.status === "active"
      ? "ring-positive"
      : technician.status === "traveling"
        ? "ring-brand"
        : "ring-ink-faint";

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: `${technician.x}%`, top: `${technician.y}%` }}
      title={`${technician.name} · ${technician.status}`}
    >
      <span
        className={`grid h-9 w-9 place-items-center rounded-full bg-sunken text-[10px] font-bold text-ink shadow-lg ring-2 ${ring}`}
      >
        {technician.initials}
      </span>
    </div>
  );
}

function LiveMap({ technicians, source }: Pick<DashboardSnapshot, "technicians" | "source">) {
  return (
    <Panel className="min-w-0 overflow-hidden">
      <PanelHeading
        title="Live route"
        action={
          <Link
            href="/route"
            className="tap-target inline-flex items-center gap-1.5 rounded-full bg-positive-bg px-3 py-1 text-[10px] font-semibold text-positive"
          >
            <Route className="h-3 w-3" aria-hidden /> Build route
          </Link>
        }
      />
      <p className="mt-1 text-[11px] text-ink-muted">
        {technicians.length} {technicians.length === 1 ? "technician" : "technicians"} · Central
        Coast
      </p>
      {/* The whole map opens the route. It was previously decoration with two
          small buttons in the corner, so the obvious thing to tap did nothing. */}
      <Link
        href="/route"
        aria-label="Open today's route on the map"
        className="tap-card relative mt-3 block h-[246px] overflow-hidden rounded-control border border-line"
        style={{
          // A sketch, not a map: the real one lives on /route, which this opens.
          backgroundColor: "var(--color-sunken)",
          backgroundImage:
            "linear-gradient(rgba(255,255,255,.04) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.04) 1px, transparent 1px)",
          backgroundSize: "26px 26px, 26px 26px",
        }}
      >
        <svg viewBox="0 0 500 260" className="absolute inset-0 h-full w-full" aria-hidden>
          <path
            d="M-20 205 C80 180 95 105 170 130 S285 215 350 150 S410 55 530 90"
            fill="none"
            stroke="var(--color-info)"
            strokeWidth="14"
            opacity=".18"
          />
          <path
            d="M-20 205 C80 180 95 105 170 130 S285 215 350 150 S410 55 530 90"
            fill="none"
            stroke="var(--color-info)"
            strokeWidth="4"
            opacity=".5"
          />
          <path
            d="M20 72 C120 115 210 58 272 92 S386 210 505 189"
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
            opacity=".28"
          />
          <path
            d="M90 -10 C98 70 132 135 116 270"
            fill="none"
            stroke="var(--color-brand)"
            strokeWidth="2"
            opacity=".18"
          />
        </svg>
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
          <p className="text-[11px] font-bold tracking-[0.18em] text-ink-muted">NIPOMO</p>
          <span className="mt-1 inline-block h-3 w-3 rounded-full border-2 border-canvas bg-info shadow-[0_0_0_5px_rgba(96,165,250,.18)]" />
        </div>
        {technicians.map((technician) => (
          <TechnicianPin key={technician.name} technician={technician} />
        ))}
        <div className="absolute bottom-3 left-3 rounded-chip border border-line bg-canvas/85 px-2.5 py-2 text-[10px] text-ink-muted backdrop-blur">
          {source === "demo" ? (
            <>
              <span className="font-semibold text-ink">42 min</span> drive time saved today
            </>
          ) : (
            <span className="font-semibold text-ink">Route optimization ready</span>
          )}
        </div>
        <span className="absolute right-3 top-3 grid h-10 w-10 place-items-center rounded-chip border border-line bg-canvas/85 text-ink backdrop-blur">
          <Navigation className="h-4 w-4" aria-hidden />
        </span>
      </Link>
    </Panel>
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
    <Panel id="assistant" className="min-w-0">
      <PanelHeading title="AI assistant" />
      <p className="mt-5 text-xs text-ink-muted">How can I help you today?</p>
      <div className="mt-3 space-y-2">
        {aiActions.map(({ label, icon: Icon, href }) => (
          <Link
            key={label}
            href={href}
            className="tap-target flex items-center gap-2.5 rounded-chip border border-line px-3 text-xs text-ink-muted transition hover:border-brand/50 hover:bg-raised hover:text-ink"
          >
            <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} aria-hidden />
            <span>{label}</span>
            <ChevronRight className="ml-auto h-3 w-3 text-ink-faint" aria-hidden />
          </Link>
        ))}
      </div>
      <form className="mt-5 flex items-center gap-2" action="/search">
        <label htmlFor="assistant-question" className="sr-only">
          Ask the AI assistant
        </label>
        <input
          id="assistant-question"
          name="query"
          placeholder="Ask anything…"
          className="min-h-11 min-w-0 flex-1 rounded-chip border border-line bg-raised px-3 text-xs text-ink outline-none placeholder:text-ink-faint focus:border-brand/70"
        />
        <button
          type="submit"
          className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-chip bg-brand text-on-brand"
          aria-label="Send question"
        >
          <Send className="h-4 w-4" aria-hidden />
        </button>
      </form>
    </Panel>
  );
}

export function InvoiceOverview({
  invoiceAging,
  outstandingValue,
}: Pick<DashboardSnapshot, "invoiceAging"> & { outstandingValue: string }) {
  return (
    <Link
      href="/invoices?status=unpaid"
      id="invoices"
      className="tap-card block rounded-panel border border-line bg-surface p-4"
      aria-label="Open unpaid invoices"
    >
      <PanelHeading
        title="Invoices overview"
        action={<CircleDollarSign className="h-4 w-4 text-ink-faint" aria-hidden />}
      />
      <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">{outstandingValue}</p>
      <p className="text-[10px] text-ink-muted">Outstanding</p>
      <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-white/10">
        {invoiceAging.map((item, index) => (
          <span
            key={item.label}
            style={{ width: `${item.percent}%` }}
            className={index === 0 ? "bg-critical" : index === 1 ? "bg-caution" : "bg-brand"}
          />
        ))}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {invoiceAging.map((item) => (
          <div key={item.label}>
            <p className="text-xs font-semibold text-ink">{item.value}</p>
            <p className="text-[9px] text-ink-muted">{item.label}</p>
          </div>
        ))}
      </div>
    </Link>
  );
}

export function ProfitOverview({ profit }: Pick<DashboardSnapshot, "profit">) {
  return (
    <Link
      href="/invoices?status=paid"
      id="reports"
      className="tap-card block rounded-panel border border-line bg-surface p-4"
      aria-label="Open paid invoices and revenue"
    >
      <PanelHeading
        title="Profit overview"
        action={<span className="text-[10px] text-ink-muted">MTD</span>}
      />
      <p className="mt-3 text-2xl font-semibold tracking-tight text-ink">{profit.value}</p>
      <p className="text-[10px] font-medium text-ink-muted">{profit.change}</p>
      {/* No trend line until there is a trend. An empty array would make
          Math.max return -Infinity and draw a broken path. */}
      {profit.chart.length > 1 ? (
        <div className="mt-2">
          <Sparkline values={profit.chart} large />
        </div>
      ) : null}
    </Link>
  );
}

function InventoryOverview({ lowStock }: Pick<DashboardSnapshot, "lowStock">) {
  return (
    <Panel id="inventory">
      <PanelHeading
        title="Inventory low stock"
        action={<PackageOpen className="h-4 w-4 text-ink-faint" aria-hidden />}
      />
      <div className="mt-3 space-y-2.5">
        {lowStock.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-muted">No low-stock items yet.</p>
        ) : (
          lowStock.map((item) => (
            <Link
              key={item.name}
              href={`/materials?query=${encodeURIComponent(item.name)}`}
              className="tap-row flex min-h-11 items-center justify-between gap-3 rounded-chip px-2 text-xs"
            >
              <span className="truncate text-ink-muted">{item.name}</span>
              <span className="shrink-0 font-semibold text-caution">
                {item.quantity} {item.unit}
              </span>
            </Link>
          ))
        )}
      </div>
      <Link
        href="/materials"
        className="tap-target mt-2 flex items-center justify-center gap-1 text-[10px] font-semibold text-info"
      >
        View all inventory <ChevronRight className="h-3 w-3" aria-hidden />
      </Link>
    </Panel>
  );
}

export function RecentActivity({ activity }: Pick<DashboardSnapshot, "activity">) {
  return (
    <Panel>
      <PanelHeading
        title="Recent activity"
        action={<ClipboardCheck className="h-4 w-4 text-ink-faint" aria-hidden />}
      />
      <div className="mt-3 space-y-3">
        {activity.length === 0 ? (
          <p className="py-6 text-center text-xs text-ink-muted">
            Activity will appear as work is added.
          </p>
        ) : (
          activity.map((item) => (
            <Link
              key={`${item.label}-${item.when}`}
              href={
                item.label.includes("Invoice")
                  ? "/invoices"
                  : item.label.includes("Job")
                    ? "/jobs/1048"
                    : "/search"
              }
              className="tap-row flex min-h-11 items-center gap-2 rounded-chip px-1 text-[11px]"
            >
              <span
                className={`h-2 w-2 rounded-full border-2 ${item.tone === "danger" ? "border-critical" : "border-ink-faint"}`}
              />
              <span className="min-w-0 flex-1 truncate text-ink-muted">{item.label}</span>
              <time className="shrink-0 text-[9px] text-ink-faint">{item.when}</time>
            </Link>
          ))
        )}
      </div>
    </Panel>
  );
}

export function DashboardShell({
  snapshot,
  jobs,
  attention,
}: {
  snapshot: DashboardSnapshot;
  /** Real jobs. The snapshot's own `schedule` is never populated for a live
   *  business — it returns [] — so the panel that read it has always been
   *  empty outside the demo. */
  jobs: PilotJob[];
  attention: AttentionItem[];
}) {
  const today = todayInZone(snapshot.timezone);
  const nextUp = nextJob(jobs, today);
  const activeToday = todaysJobs(jobs, today);
  const canceled = canceledToday(jobs, today);

  const metricDestinations = [
    "/invoices?status=paid",
    "/schedule",
    "/technicians",
    "/search",
    "/invoices?status=unpaid",
  ];

  return (
    <main id="dashboard" className="min-h-screen bg-canvas p-2 pb-28 text-ink sm:p-3 lg:pb-3">
      <MobileAppChrome />
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppSidebar businessName={snapshot.businessName} ownerName={snapshot.ownerName} />
        <div className="min-w-0 lg:px-4 lg:py-2">
          <Header
            ownerName={snapshot.ownerName}
            source={snapshot.source}
            timeZone={snapshot.timezone}
          />

          {/*
            The working day first. Metrics used to open the page and the
            schedule arrived in the third section; an electrician in a truck
            wants the next job, and everything else can wait for a scroll.
          */}
          {nextUp ? (
            <div className="mt-5">
              <NextJobCard job={nextUp} isToday={nextUp.date === today} />
            </div>
          ) : null}

          <TodaysJobs jobs={activeToday} canceledCount={canceled.length} />

          <NeedsAttention items={attention} />

          <section aria-labelledby="snapshot-heading" className="mt-5">
            <div className="mb-2 flex items-end justify-between px-1">
              <h2 id="snapshot-heading" className="text-sm font-semibold">
                Business
              </h2>
              <Link href="/reports" className="text-xs font-semibold text-brand">
                Reports
              </Link>
            </div>
            <div
              className="grid auto-cols-[minmax(160px,1fr)] grid-flow-col gap-2 overflow-x-auto pb-2 [scrollbar-width:none] lg:grid-flow-row lg:grid-cols-5 lg:overflow-visible"
              role="region"
              aria-label="Business metrics"
              tabIndex={0}
            >
              {snapshot.metrics.map((metric, index) => (
                <MetricCard
                  key={metric.label}
                  metric={metric}
                  href={metricDestinations[index] ?? "/"}
                />
              ))}
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
