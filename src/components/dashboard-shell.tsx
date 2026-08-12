import Link from "next/link";
import {
  Bell,
  CircleDollarSign,
  ClipboardCheck,
  Plus,
  Search,
  Zap,
} from "lucide-react";

import { AppSidebar } from "@/components/app-sidebar";
import { MobileAppChrome } from "@/components/mobile-app-chrome";
import { AccountMenu } from "@/components/account-menu";
import type { DashboardMetric, DashboardSnapshot } from "@/lib/dashboard";
import { NeedsAttention, NextJobCard, TodaysJobs } from "@/components/dashboard-today";
import { todayInZone } from "@/lib/calendar";
import {
  canceledToday,
  greeting,
  greetingName,
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

function MetricCard({
  metric,
  href,
  spanWhenOdd = false,
}: {
  metric: DashboardMetric;
  href: string;
  /** Fill the row rather than sit half empty as the last of an odd number. */
  spanWhenOdd?: boolean;
}) {
  return (
    <Link
      href={href}
      // No min-width. It was there to give the old horizontal strip something
      // to scroll, and in a two-column grid it is the thing that pushes the
      // page wider than a 320px phone.
      className={`tap-card block min-h-[112px] rounded-control border border-line bg-surface p-4 ${
        spanWhenOdd ? "col-span-2 sm:col-span-1" : ""
      }`}
      aria-label={`${metric.label}: ${metric.value}. Open details`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-[0.04em] text-ink-muted">
        {metric.label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        {/* min-w-0 so a long detail line wraps inside the tile rather than
            refusing to shrink and shouldering the sparkline out of it. Half a
            phone is much less room than the strip these were designed in. */}
        <div className="min-w-0">
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
  ownerNames,
  ownerEmail,
  timeZone,
}: {
  ownerNames: string[];
  ownerEmail: string;
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
  // Every place a name might be, best first, rather than the profile column
  // alone. That column is NOT NULL, so signing up fills it with whatever is to
  // hand — here, the local part of an email — which `firstName` then correctly
  // refuses, leaving a bare "Good afternoon" and no way to fix it.
  const hello = greeting(hour);
  const name = greetingName(ownerNames, ownerEmail);

  return (
    <header className="flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2.5">
          <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
          <h1 className="text-[26px] font-semibold tracking-[-0.035em] text-ink">
            {/* No trailing comma when there is no name to put after it. */}
            {name ? `${hello}, ${name}` : hello}
          </h1>
        </div>
        {/*
          The date, and nothing else. There used to be a green dot and "Live
          business data" beside it, which told an electrician something they
          already assumed and cost a line of the screen to say.
        */}
        <p className="mt-1 pl-10 text-xs text-ink-muted">{dateLabel}</p>
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
    <main id="dashboard" className="min-h-screen bg-canvas p-2 pb-[calc(7rem+env(safe-area-inset-bottom))] text-ink sm:p-3 lg:pb-3">
      <MobileAppChrome />
      <div className="mx-auto grid max-w-[1760px] gap-2 lg:grid-cols-[248px_minmax(0,1fr)]">
        <AppSidebar businessName={snapshot.businessName} ownerName={snapshot.ownerName} />
        <div className="min-w-0 lg:px-4 lg:py-2" id="main-content" tabIndex={-1}>
          <Header
            ownerNames={snapshot.ownerNames}
            ownerEmail={snapshot.ownerEmail}
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
            {/*
              Two columns on a phone rather than a sideways scroll.

              These five used to sit in a horizontal strip, so three of them
              were off the right edge of the screen with nothing to say they
              were there — a row of numbers only reads as a row if you can see
              it, and nobody swipes a dashboard they think they have finished.

              The odd one out spans the full width instead of sitting half
              empty beside a gap. The wrapper is no longer a focusable scroll
              region: it does not scroll now, and a tab stop that goes nowhere
              is one more press between a keyboard user and the page.
            */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
              {snapshot.metrics.map((metric, index) => (
                <MetricCard
                  key={metric.label}
                  metric={metric}
                  href={metricDestinations[index] ?? "/"}
                  // Only when it would otherwise be alone on the last row, and
                  // only in the two-column layout that can strand it.
                  spanWhenOdd={
                    snapshot.metrics.length % 2 === 1 &&
                    index === snapshot.metrics.length - 1
                  }
                />
              ))}
            </div>
          </section>

        </div>
      </div>
    </main>
  );
}
