import "server-only";

import { createClient } from "@/lib/supabase/server";
import { shiftDays, todayInZone } from "@/lib/calendar";
import {
  estimatesDetail,
  invoicesDetail,
  isOverdue,
  invoiceAging,
  jobsDetail,
  profitSummary,
  revenueDetail,
  techniciansDetail,
} from "@/lib/dashboard-metrics";
import { currentContext, currentUser } from "@/lib/request-context";
import { zonedWallClockToIso } from "@/lib/schedule-labels";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

export type DashboardMetric = {
  label: string;
  value: string;
  detail: string;
  tone?: "positive" | "danger" | "neutral";
  chart?: number[];
};

export type ScheduleItem = {
  id: string;
  time: string;
  customer: string;
  summary: string;
  city: string;
  status: "In progress" | "Scheduled" | "Pending";
  technician: string;
};

export type TechnicianMarker = {
  name: string;
  initials: string;
  status: "active" | "traveling" | "idle";
  x: number;
  y: number;
};

export type DashboardSnapshot = {
  source: "demo" | "supabase";
  /** The business timezone. The header's date and greeting are read from it. */
  timezone: string;
  requiresOnboarding: boolean;
  businessName: string;
  businessSlug: string | null;
  ownerName: string;
  /** Every place a real name might live, best first. See `greetingName`. */
  ownerNames: string[];
  ownerEmail: string;
  metrics: DashboardMetric[];
  schedule: ScheduleItem[];
  technicians: TechnicianMarker[];
  invoiceAging: { label: string; value: string; percent: number }[];
  profit: { value: string; change: string; chart: number[] };
  lowStock: { name: string; quantity: number; unit: string }[];
  activity: { label: string; when: string; tone?: "danger" }[];
};

const demoSnapshot: DashboardSnapshot = {
  source: "demo",
  timezone: DEFAULT_TIMEZONE,
  requiresOnboarding: false,
  businessName: "Pacific Plains Electric",
  businessSlug: null,
  ownerName: "Adam",
  ownerNames: ["Adam"],
  ownerEmail: "",
  metrics: [
    {
      label: "Today’s revenue",
      value: "$6,842",
      detail: "+18% vs yesterday",
      tone: "positive",
      chart: [12, 18, 16, 28, 23, 37, 31, 49, 38, 54],
    },
    { label: "Jobs today", value: "8", detail: "3 in progress" },
    { label: "Electricians", value: "6", detail: "2 on the way" },
    { label: "Open estimates", value: "12", detail: "$45,680 pending" },
    {
      label: "Unpaid invoices",
      value: "$12,430",
      detail: "5 overdue",
      tone: "danger",
    },
  ],
  schedule: [
    {
      id: "1045",
      time: "8:00 AM",
      customer: "Smith Residence",
      summary: "Panel upgrade",
      city: "Santa Maria, CA",
      status: "In progress",
      technician: "MD",
    },
    {
      id: "1046",
      time: "10:30 AM",
      customer: "Johnson Commercial",
      summary: "Lighting retrofit",
      city: "Arroyo Grande, CA",
      status: "Scheduled",
      technician: "JR",
    },
    {
      id: "1047",
      time: "1:00 PM",
      customer: "Williams Home",
      summary: "EV charger install",
      city: "Nipomo, CA",
      status: "Scheduled",
      technician: "MS",
    },
    {
      id: "1048",
      time: "3:30 PM",
      customer: "Davis Residence",
      summary: "Outlet repair",
      city: "Oceano, CA",
      status: "Pending",
      technician: "AB",
    },
  ],
  technicians: [
    { name: "Mike Davis", initials: "MD", status: "active", x: 64, y: 34 },
    { name: "Jordan Ruiz", initials: "JR", status: "traveling", x: 78, y: 67 },
    { name: "Maya Stone", initials: "MS", status: "active", x: 42, y: 73 },
    { name: "Alex Brooks", initials: "AB", status: "idle", x: 24, y: 46 },
  ],
  invoiceAging: [
    { label: "1–30 days", value: "$8,230", percent: 66 },
    { label: "31–60 days", value: "$3,250", percent: 26 },
    { label: "60+ days", value: "$950", percent: 8 },
  ],
  profit: {
    value: "$18,560",
    change: "+22% vs last month",
    chart: [11, 12, 12, 14, 13, 16, 18, 16, 22, 24, 19, 28, 25, 31, 35],
  },
  lowStock: [
    { name: "AFCI Breaker 20A", quantity: 4, unit: "left" },
    { name: "GFCI Receptacle", quantity: 6, unit: "left" },
    { name: "12/2 Romex 250 ft", quantity: 2, unit: "rolls" },
  ],
  activity: [
    { label: "Invoice INV-10024 paid", when: "2h ago" },
    { label: "Estimate EST-10056 sent", when: "3h ago" },
    { label: "Job #1048 needs review", when: "Today", tone: "danger" },
    { label: "PO #2008 received", when: "Yesterday" },
  ],
};

function hasSupabaseEnvironment() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

function formatRelativeTime(createdAt: string) {
  const elapsedMinutes = Math.max(
    0,
    Math.round((Date.now() - new Date(createdAt).getTime()) / 60_000),
  );
  const relativeTime = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  if (elapsedMinutes < 1) return "just now";
  if (elapsedMinutes < 60) return relativeTime.format(-elapsedMinutes, "minute");

  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (elapsedHours < 24) return relativeTime.format(-elapsedHours, "hour");

  return relativeTime.format(-Math.round(elapsedHours / 24), "day");
}

export async function getDashboardSnapshot(): Promise<DashboardSnapshot> {
  if (!hasSupabaseEnvironment()) return demoSnapshot;

  try {
    const supabase = await createClient();

    /*
     * Both of these are memoised for the length of the request, so the home
     * page verifies the session once rather than three times. `getUser()` is
     * not a local token decode — it is a round trip to the auth server — and
     * this module, `booking-requests` and `request-context` were each making
     * their own before anything was fetched.
     *
     * Two calls rather than one because they mean different things: no user is
     * a visitor, and a user with no business is somebody part-way through
     * signing up.
     */
    const user = await currentUser();
    if (!user) return demoSnapshot;

    const context = await currentContext();
    if (!context) return { ...demoSnapshot, requiresOnboarding: true };

    const organizationId = context.organizationId;
    const accountDatabase = asFlexibleClient(supabase);

    // "Today" is the business's day, not the server's. Production runs in UTC,
    // where setHours(0,0,0,0) is 5pm Pacific the previous afternoon — so the
    // dashboard showed part of yesterday's schedule as today's, and dropped
    // this evening's jobs entirely. Built from the business's calendar date so
    // it also survives the 23- and 25-hour days that daylight saving creates,
    // and the zones that have no daylight saving at all.
    const zone = context.timeZone || DEFAULT_TIMEZONE;
    const today = todayInZone(zone);
    const dayStart = new Date(zonedWallClockToIso(`${today}T00:00`, zone));
    const dayEnd = new Date(zonedWallClockToIso(`${shiftDays(today, 1)}T00:00`, zone));

    const [jobs, invoices, estimates, technicians, inventory, activity, profile, business] =
      await Promise.all([
        supabase
          .from("jobs")
          .select("id,status,scheduled_start")
          .eq("organization_id", organizationId)
          // Archived work is not work. Every other job query in the app filters
          // this and metrics did not, so an archived job kept its place in
          // "Jobs today" while the list of jobs underneath — which reads
          // through getJobs — correctly showed nothing. A metric that
          // contradicts the list beneath it is worse than no metric.
          .is("archived_at", null)
          .gte("scheduled_start", dayStart.toISOString())
          .lt("scheduled_start", dayEnd.toISOString()),
        supabase
          .from("invoices")
          .select("status,total_cents,balance_due_cents,due_at,paid_at")
          .eq("organization_id", organizationId),
        supabase
          .from("estimates")
          .select("status,total_cents")
          .eq("organization_id", organizationId)
          .in("status", ["draft", "sent"]),
        supabase
          .from("technicians")
          .select("id,user_id,display_name")
          .eq("organization_id", organizationId)
          .eq("is_active", true),
        supabase
          .from("inventory_items")
          .select("name,quantity_on_hand,reorder_point,unit")
          .eq("organization_id", organizationId)
          .order("quantity_on_hand", { ascending: true })
          .limit(3),
        supabase
          .from("activity_events")
          .select("label,created_at")
          .eq("organization_id", organizationId)
          .order("created_at", { ascending: false })
          .limit(4),
        accountDatabase
          .from("user_profiles")
          .select("display_name")
          .eq("user_id", user.id)
          .maybeSingle(),
        // Its own read now that the membership join is gone, and in the same
        // batch as everything else — so it costs a column rather than a wait.
        supabase.from("organizations").select("name,slug").eq("id", organizationId).maybeSingle(),
      ]);

    // "Today's revenue" summed every paid invoice the business had ever
    // issued, so the label was wrong as well as the line under it. Today means
    // today, in the business's own day, and yesterday is fetched too because a
    // comparison needs something to compare against.
    const yesterdayStart = new Date(zonedWallClockToIso(`${shiftDays(today, -1)}T00:00`, zone));
    const paidBetween = (from: Date, to: Date) =>
      (invoices.data ?? [])
        .filter((invoice) => {
          if (invoice.status !== "paid" || !invoice.paid_at) return false;
          const at = new Date(invoice.paid_at).getTime();
          return at >= from.getTime() && at < to.getTime();
        })
        .reduce((total, invoice) => total + invoice.total_cents, 0);

    const paidToday = paidBetween(dayStart, dayEnd);
    const paidYesterday = paidBetween(yesterdayStart, dayStart);

    const overdueCount = (invoices.data ?? []).filter((invoice) =>
      isOverdue({
        status: invoice.status,
        dueAt: invoice.due_at,
        balanceDueCents: invoice.balance_due_cents,
      }),
    ).length;

    // Month to date, against the same stretch of last month.
    const monthStart = new Date(zonedWallClockToIso(`${today.slice(0, 8)}01T00:00`, zone));
    const lastMonthDate = new Date(monthStart);
    lastMonthDate.setUTCMonth(lastMonthDate.getUTCMonth() - 1);
    const lastMonthStart = new Date(lastMonthDate);
    const dayOfMonth = Number(today.slice(8, 10));
    const lastMonthSameDay = new Date(lastMonthStart);
    lastMonthSameDay.setUTCDate(lastMonthSameDay.getUTCDate() + dayOfMonth);

    const monthToDate = paidBetween(monthStart, dayEnd);
    const lastMonthToDate = paidBetween(lastMonthStart, lastMonthSameDay);
    const profit = profitSummary({
      monthToDateCents: monthToDate,
      lastMonthToDateCents: lastMonthToDate,
    });

    const aging = invoiceAging(
      (invoices.data ?? []).map((invoice) => ({
        dueAt: invoice.due_at,
        balanceDueCents: invoice.balance_due_cents,
        status: invoice.status,
      })),
    );

    // A canceled job is not work. It stayed in the count, so a day whose only
    // job had been called off still read "Jobs today: 1" — and then "0 in
    // progress" underneath, which is the contradiction that gives it away.
    const allJobsToday = jobs.data ?? [];
    const jobsToday = allJobsToday.filter((job) => job.status !== "canceled");
    const canceledToday = allJobsToday.length - jobsToday.length;
    const inProgress = jobsToday.filter((job) => job.status === "in_progress").length;
    const enRoute = jobsToday.filter((job) => job.status === "en_route").length;
    const activeTechnicians = technicians.data?.length ?? 0;
    const outstanding = (invoices.data ?? []).reduce(
      (total, invoice) => total + invoice.balance_due_cents,
      0,
    );
    const estimateTotal = (estimates.data ?? []).reduce(
      (total, estimate) => total + estimate.total_cents,
      0,
    );
    const money = new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    });

    const organization = business.data as unknown as {
      name?: string;
      slug?: string;
      timezone?: string;
    } | null;

    return {
      ...demoSnapshot,
      source: "supabase",
      requiresOnboarding: false,
      businessName: organization?.name ?? demoSnapshot.businessName,
      businessSlug: organization?.slug ?? null,
      timezone: organization?.timezone || DEFAULT_TIMEZONE,
      // Every place a real name might be, best first, for `greetingName` to
      // pick through. It used to be `profile.display_name ?? technician ?? demo`
      // — and `display_name` is NOT NULL, so signing up fills it with whatever
      // is to hand. On this deployment it holds "adamkane13.ak", which the
      // greeting then correctly refused to use and fell back to nothing at all,
      // leaving a bare "Good afternoon" with no way to fix it.
      ownerName:
        (typeof profile.data?.display_name === "string" ? profile.data.display_name : null) ??
        technicians.data?.find(
          (technician) => technician.user_id === user.id,
        )?.display_name ??
        demoSnapshot.ownerName,
      ownerNames: [
        typeof profile.data?.display_name === "string" ? profile.data.display_name : "",
        technicians.data?.find((technician) => technician.user_id === user.id)
          ?.display_name ?? "",
        // Typed by a person at their identity provider, so worth more than a
        // column something filled in automatically.
        typeof user.user_metadata?.full_name === "string"
          ? user.user_metadata.full_name
          : "",
        typeof user.user_metadata?.name === "string"
          ? user.user_metadata.name
          : "",
      ].filter(Boolean),
      ownerEmail: user.email ?? "",
      metrics: [
        {
          label: "Today's revenue",
          value: money.format(paidToday / 100),
          ...revenueDetail({ todayCents: paidToday, yesterdayCents: paidYesterday }),
        },
        {
          label: "Jobs today",
          value: String(jobsToday.length),
          ...jobsDetail({ inProgress, total: jobsToday.length, canceled: canceledToday }),
        },
        {
          label: "Electricians",
          value: String(activeTechnicians),
          ...techniciansDetail({ active: activeTechnicians, enRoute }),
        },
        {
          label: "Open estimates",
          value: String(estimates.data?.length ?? 0),
          ...estimatesDetail({
            pendingCents: estimateTotal,
            count: estimates.data?.length ?? 0,
          }),
        },
        {
          label: "Unpaid invoices",
          value: money.format(outstanding / 100),
          ...invoicesDetail({ outstandingCents: outstanding, overdue: overdueCount }),
        },
      ],
      profit: { value: profit.value, change: profit.change, chart: [] },
      invoiceAging: aging,
      schedule: [],
      technicians:
        technicians.data?.map((technician, index) => ({
          name: technician.display_name,
          initials: technician.display_name
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0]?.toUpperCase() ?? "")
            .join(""),
          status: "idle" as const,
          x: 42 + (index % 3) * 14,
          y: 44 + (index % 2) * 18,
        })) ?? [],
      lowStock:
        inventory.data?.map((item) => ({
          name: item.name,
          quantity: Number(item.quantity_on_hand),
          unit: item.unit,
        })) ?? [],
      activity:
        activity.data?.map((event) => ({
          label: event.label,
          when: formatRelativeTime(event.created_at),
        })) ?? [],
    };
  } catch {
    return demoSnapshot;
  }
}
