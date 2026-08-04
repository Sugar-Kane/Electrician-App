import "server-only";

import { createClient } from "@/lib/supabase/server";

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
  requiresOnboarding: boolean;
  businessName: string;
  ownerName: string;
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
  requiresOnboarding: false,
  businessName: "Pacific Plains Electric",
  ownerName: "Adam",
  metrics: [
    {
      label: "Today’s revenue",
      value: "$6,842",
      detail: "+18% vs yesterday",
      tone: "positive",
      chart: [12, 18, 16, 28, 23, 37, 31, 49, 38, 54],
    },
    { label: "Jobs today", value: "8", detail: "3 in progress" },
    { label: "Techs working", value: "6", detail: "2 on the way" },
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
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return demoSnapshot;

    const { data: membership } = await supabase
      .from("organization_members")
      .select("organization_id, organizations(name)")
      .eq("user_id", authData.user.id)
      .limit(1)
      .maybeSingle();

    if (!membership) return { ...demoSnapshot, requiresOnboarding: true };
    const organizationId = membership.organization_id;
    const dayStart = new Date();
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const [jobs, invoices, estimates, technicians, inventory, activity] =
      await Promise.all([
        supabase
          .from("jobs")
          .select("id,status,scheduled_start")
          .eq("organization_id", organizationId)
          .gte("scheduled_start", dayStart.toISOString())
          .lt("scheduled_start", dayEnd.toISOString()),
        supabase
          .from("invoices")
          .select("status,total_cents,balance_due_cents")
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
      ]);

    const paidToday = (invoices.data ?? [])
      .filter((invoice) => invoice.status === "paid")
      .reduce((total, invoice) => total + invoice.total_cents, 0);
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

    return {
      ...demoSnapshot,
      source: "supabase",
      requiresOnboarding: false,
      businessName:
        (membership.organizations as unknown as { name?: string } | null)?.name ??
        demoSnapshot.businessName,
      ownerName:
        technicians.data?.find(
          (technician) => technician.user_id === authData.user.id,
        )?.display_name ?? demoSnapshot.ownerName,
      metrics: [
        { ...demoSnapshot.metrics[0], value: money.format(paidToday / 100) },
        {
          ...demoSnapshot.metrics[1],
          value: String(jobs.data?.length ?? 0),
          detail: `${jobs.data?.filter((job) => job.status === "in_progress").length ?? 0} in progress`,
        },
        {
          ...demoSnapshot.metrics[2],
          value: String(technicians.data?.length ?? 0),
        },
        {
          ...demoSnapshot.metrics[3],
          value: String(estimates.data?.length ?? 0),
          detail: `${money.format(estimateTotal / 100)} pending`,
        },
        { ...demoSnapshot.metrics[4], value: money.format(outstanding / 100) },
      ],
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
      invoiceAging: [
        { label: "1–30 days", value: "$0", percent: 0 },
        { label: "31–60 days", value: "$0", percent: 0 },
        { label: "60+ days", value: "$0", percent: 0 },
      ],
      profit: {
        value: money.format(paidToday / 100),
        change: "No prior month data",
        chart: [0, 0, 0, 0, 0, 0, 0, 0],
      },
      lowStock:
        inventory.data?.map((item) => ({
          name: item.name,
          quantity: Number(item.quantity_on_hand),
          unit: item.unit,
        })) ?? demoSnapshot.lowStock,
      activity:
        activity.data?.map((event) => ({
          label: event.label,
          when: formatRelativeTime(event.created_at),
        })) ?? demoSnapshot.activity,
    };
  } catch {
    return demoSnapshot;
  }
}
