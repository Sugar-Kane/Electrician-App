import "server-only";

import { cache } from "react";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { defaultBusinessHours, parseBusinessHours } from "@/lib/business-hours";
import type { DateHours } from "@/lib/date-hours";
import { formatDayLabel, isoDateInZone, shiftDays, todayInZone, workWeekStart } from "@/lib/calendar";
import type { ActivityRow } from "@/lib/activity-timeline";
import { hasCoordinates } from "@/lib/coordinates";
import type { CrewBusiness, CrewMember, CrewTimeOff } from "@/lib/crew-week";
import type { DayHours } from "@/lib/electrician-hours";
import { jobCategoryLabel } from "@/lib/new-job-input";
import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isoToZonedWallClock, zonedWallClockToIso } from "@/lib/schedule-labels";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";
import {
  pilotInvoices,
  pilotJobs,
  type JobStatus,
  type PilotInvoice,
  type PilotJob,
} from "@/lib/pilot-data";

/**
 * Live job and invoice data from Supabase, returned in the same shapes the
 * pages already render (`PilotJob` / `PilotInvoice`) so no JSX has to change.
 *
 * Falls back to the hardcoded pilot data when there is no signed-in user or no
 * organization membership — mirroring how `dashboard.ts` falls back to its
 * demo snapshot. That keeps the signed-out marketing view working while giving
 * signed-in users their real records.
 *
 * The `documents` and `materials` fields on `PilotJob` stay empty here. Both
 * are real now — documents in `public.documents`, hours and parts in
 * `public.job_line_items` — but they are read by `job-line-data.ts` and the
 * files page, which return them in their own shapes rather than squeezing them
 * into fixtures written for the demo view.
 */

type Source = "demo" | "supabase";

const JOB_STATUS: Record<string, JobStatus> = {
  in_progress: "In progress",
  en_route: "In progress",
  arrived: "In progress",
  confirmed: "Scheduled",
  assigned: "Scheduled",
  rescheduled: "Scheduled",
  completed: "Completed",
  draft: "Pending",
  awaiting_payment: "Pending",
  // Work that is done and not signed off. It is what the job screen calls
  // "Ready to complete", and reading as "Pending" put a finished visit in the
  // same bucket on the schedule as one that was never confirmed.
  needs_review: "In progress",
  // Its own state, not a pending one: a cancelled job that reads as "Pending"
  // is indistinguishable from work still to come.
  canceled: "Canceled",
  no_show: "Pending",
};

const INVOICE_STATUS: Record<string, PilotInvoice["status"]> = {
  paid: "Paid",
  overdue: "Overdue",
  draft: "Unpaid",
  sent: "Unpaid",
  partially_paid: "Unpaid",
  void: "Unpaid",
};

function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2)
    .map((p) => p[0]!.toUpperCase()).join("");
}

/** Format an instant in the organization's timezone, never the server's. */
function inZone(iso: string | null, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, ...opts }).format(new Date(iso));
}

/**
 * Who this request is for, and a client to read with.
 *
 * The session half is memoised for the request, so a page that calls getJobs()
 * and getInvoices() verifies the token once rather than once per function.
 */
async function resolveContext() {
  const context = await currentContext();
  if (!context) return null;

  return {
    database: asFlexibleClient(await createClient()),
    organizationId: context.organizationId,
    timeZone: context.timeZone || DEFAULT_TIMEZONE,
  };
}

/**
 * Slide the demo jobs onto the current work week.
 *
 * The pilot data is written against a fixed week in August 2026. Left alone it
 * would make the schedule look empty forever to anyone signed out or still
 * setting up, because the calendar now shows the real current week.
 */
function rebaseDemoJobs(jobs: PilotJob[], timeZone: string): PilotJob[] {
  const demoStart = jobs.reduce(
    (earliest, job) => (job.date && job.date < earliest ? job.date : earliest),
    jobs[0]?.date ?? "",
  );
  if (!demoStart) return jobs;

  const offset =
    (Date.parse(`${workWeekStart(todayInZone(timeZone))}T12:00:00Z`) -
      Date.parse(`${workWeekStart(demoStart)}T12:00:00Z`)) /
    86_400_000;
  if (offset === 0) return jobs;

  return jobs.map((job) => {
    if (!job.date) return job;
    const date = shiftDays(job.date, offset);
    return { ...job, date, dateLabel: formatDayLabel(date) };
  });
}

// deno-lint-ignore-file
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function mapJob(row: any, timeZone: string): PilotJob {
  const customer = row.customers ?? {};
  const property = row.properties ?? {};
  const technician = row.technicians ?? {};

  // Embedded from the request that created this job, if there was one. A job
  // with none was typed in by the business, which is what "manual" means — so
  // the absence of a row is the answer rather than a missing value.
  const request = Array.isArray(row.booking_requests)
    ? row.booking_requests[0]
    : (row.booking_requests ?? null);
  const channel = request?.communication_channel;

  const customerName: string =
    customer.company_name ||
    [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
    "Customer";
  const technicianName: string = technician.display_name ?? "Unassigned";

  return {
    id: String(row.job_number ?? row.id),
    // YYYY-MM-DD, because the schedule matches jobs to a calendar day by this
    // exact string. en-US formatting would produce "08/03/2026" and quietly
    // match nothing.
    date: row.scheduled_start ? isoDateInZone(new Date(row.scheduled_start), timeZone) : "",
    dateLabel: inZone(row.scheduled_start, timeZone, { weekday: "short", month: "short", day: "numeric" }),
    time: inZone(row.scheduled_start, timeZone, { hour: "numeric", minute: "2-digit" }),
    endTime: inZone(row.scheduled_end, timeZone, { hour: "numeric", minute: "2-digit" }),
    customer: customerName,
    contactName: [customer.first_name, customer.last_name].filter(Boolean).join(" ") || customerName,
    phone: customer.phone ?? "",
    email: customer.email ?? "",
    address: property.address_line_1 ?? "",
    city: property.city ?? "",
    // A label, not the column. The list holds `work_order` and, on jobs
    // booked before the kinds of work changed, `panel_breaker` and the rest —
    // and every screen that shows this shows it to a person.
    workType: jobCategoryLabel(String(row.category ?? "")),
    summary: row.customer_description ?? row.ai_summary ?? "",
    status: JOB_STATUS[row.status] ?? "Pending",
    technician: technicianName,
    technicianInitials: initialsOf(technicianName),
    accessNotes: property.access_notes ?? "",
    serviceNotes: row.ai_summary ?? "",
    channel:
      channel === "phone" || channel === "sms" || channel === "web" ? channel : "manual",
    // Null when the address has never been geocoded, rather than 0,0 — which
    // is a real point in the Atlantic and would put every phone-booked job in
    // the ocean the moment anything plotted it.
    coordinates: hasCoordinates({
      lat: property.latitude === null || property.latitude === undefined ? null : Number(property.latitude),
      lng: property.longitude === null || property.longitude === undefined ? null : Number(property.longitude),
    })
      ? { lat: Number(property.latitude), lng: Number(property.longitude) }
      : null,
    // No documents or job_materials tables yet — empty beats showing mock
    // attachments that belong to a different job.
    documents: [],
    materials: [],
  };
}

const JOB_SELECT = `
  id, job_number, status, category, customer_description, ai_summary,
  scheduled_start, scheduled_end,
  customers ( first_name, last_name, company_name, phone, email ),
  properties ( address_line_1, city, latitude, longitude, access_notes ),
  technicians ( display_name ),
  booking_requests ( communication_channel )
`;

/**
 * Every job the business still has, memoised for the request.
 *
 * One page render calls this more than once — Home reads it directly and again
 * through the metrics, and `/route` reads it beside the map — and each call was
 * its own trip to the database for the same rows. `cache()` collapses them to
 * one, and re-fetches on the next request rather than serving anything stale.
 */
export const getJobs = cache(async function getJobs(): Promise<{
  jobs: PilotJob[];
  source: Source;
}> {
  const context = await resolveContext();
  if (!context) return { jobs: rebaseDemoJobs(pilotJobs, DEFAULT_TIMEZONE), source: "demo" };

  const { data, error } = await context.database
    .from("jobs")
    .select(JOB_SELECT)
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("scheduled_start", { ascending: true });

  // A real business with no jobs has no jobs. Falling back to the pilot
  // fixtures here is what put four invented customers in front of an
  // electrician who had just signed up, with no way to tell which of their
  // records were real.
  if (error) return { jobs: [], source: "supabase" };
  return { jobs: (data ?? []).map((row) => mapJob(row, context.timeZone)), source: "supabase" };
});

export async function getJob(id: string): Promise<{ job: PilotJob | null; source: Source }> {
  const context = await resolveContext();
  if (!context) {
    const jobs = rebaseDemoJobs(pilotJobs, DEFAULT_TIMEZONE);
    return { job: jobs.find((j) => j.id === id) ?? null, source: "demo" };
  }

  // Pages link by job_number, which is what mapJob exposes as `id`.
  const numeric = Number(id);
  const query = context.database
    .from("jobs")
    .select(JOB_SELECT)
    .eq("organization_id", context.organizationId);

  const { data, error } = Number.isFinite(numeric)
    ? await query.eq("job_number", numeric).maybeSingle()
    : await query.eq("id", id).maybeSingle();

  // Not found for a signed-in business means not found, so the page 404s
  // rather than showing somebody a fictional job under a real job number.
  if (error || !data) return { job: null, source: "supabase" };
  return { job: mapJob(data, context.timeZone), source: "supabase" };
}

export async function getInvoices(): Promise<{ invoices: PilotInvoice[]; source: Source }> {
  const context = await resolveContext();
  if (!context) return { invoices: pilotInvoices, source: "demo" };

  const { data, error } = await context.database
    .from("invoices")
    .select(`
      id, invoice_number, status, total_cents, balance_due_cents, due_at, last_sent_at,
      jobs ( job_number, customers ( first_name, last_name, company_name, phone, email ) )
    `)
    .eq("organization_id", context.organizationId)
    .order("due_at", { ascending: true });

  if (error) return { invoices: [], source: "supabase" };
  if (!data?.length) return { invoices: [], source: "supabase" };

  const invoices: PilotInvoice[] = data.map((raw) => {
    // The relational select is wider than the generated types describe, so the
    // row is narrowed here rather than fighting the inferred shape.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const row = raw as any;
    const job = row.jobs ?? {};
    const customer = job.customers ?? {};
    const name: string =
      customer.company_name ||
      [customer.first_name, customer.last_name].filter(Boolean).join(" ") ||
      "Customer";
    return {
      id: `INV-${row.invoice_number}`,
      customer: name,
      // Cents in the database; the UI renders dollars.
      amount: Number(row.total_cents ?? 0) / 100,
      status: INVOICE_STATUS[String(row.status)] ?? "Unpaid",
      due: inZone(row.due_at as string | null, context.timeZone, {
        month: "short", day: "numeric", year: "numeric",
      }),
      jobId: String(job.job_number ?? ""),
      recordId: String(row.id ?? ""),
      customerPhone: String(customer.phone ?? ""),
      customerEmail: String(customer.email ?? ""),
      // What is still outstanding, kept alongside the total so a screen can
      // show both. The sent message quotes the total, not this.
      balance: Number(row.balance_due_cents ?? row.total_cents ?? 0) / 100,
      sentLabel: row.last_sent_at
        ? inZone(row.last_sent_at as string, context.timeZone, {
            month: "short", day: "numeric",
          })
        : "",
    };
  });

  return { invoices, source: "supabase" };
}

/**
 * The raw fields the edit and cancel controls need.
 *
 * Separate from `getJob` on purpose: that returns a `PilotJob` of display
 * strings, and editing needs the instants and the database's own status value.
 * Returns null for the demo fallback, because there is nothing real to edit —
 * the controls simply do not render rather than pretending to save.
 */
export async function getJobControls(jobNumber: string): Promise<{
  jobNumber: string;
  status: string;
  startLocal: string;
  endLocal: string;
  /** The zone those wall-clock strings belong to, for the date picker. */
  timeZone: string;
  canceled: boolean;
  cancellationReason: string;
  customerPhone: string;
  customerEmail: string;
  technicianNotes: string;
} | null> {
  const context = await resolveContext();
  if (!context) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await context.database
    .from("jobs")
    .select(
      `job_number, status, canceled_at, cancellation_reason, technician_notes,
       scheduled_start, scheduled_end, arrival_window_start, arrival_window_end,
       customers ( phone, email )`,
    )
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!data) return null;

  const row = data as Record<string, unknown>;
  const customer = (row.customers ?? null) as Record<string, unknown> | null;
  const str = (value: unknown) => (typeof value === "string" ? value : "");

  const start = str(row.arrival_window_start) || str(row.scheduled_start);
  const end = str(row.arrival_window_end) || str(row.scheduled_end);

  return {
    jobNumber: String(row.job_number ?? jobNumber),
    status: str(row.status),
    startLocal: isoToZonedWallClock(start, context.timeZone),
    endLocal: isoToZonedWallClock(end, context.timeZone),
    timeZone: context.timeZone,
    canceled: str(row.status) === "canceled",
    cancellationReason: str(row.cancellation_reason),
    customerPhone: str(customer?.phone),
    customerEmail: str(customer?.email),
    technicianNotes: str(row.technician_notes),
  };
}

export type TechnicianBlackout = {
  id: string;
  startsAt: string;
  endsAt: string;
  label: string;
  reason: string;
};

export type TechnicianWorkload = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  isActive: boolean;
  /** True when this row is the signed-in user's own. */
  isMe: boolean;
  hours: { weekday: number; start: string; end: string }[];
  /** Days set on their own, which answer ahead of the weekly pattern. */
  dateHours: DateHours[];
  blackouts: TechnicianBlackout[];
  jobs: { id: string; customer: string; time: string; status: JobStatus; city: string }[];
};

export type CrewRoster = {
  technicians: TechnicianWorkload[];
  source: Source;
  /** Whether the caller may change any of this. */
  canManage: boolean;
  /** False when the owner is not on the crew, which is what offers the button. */
  selfIsElectrician: boolean;
  /** Days the whole business is closed — blackouts with no electrician named. */
  businessBlackouts: TechnicianBlackout[];
  /**
   * The days the business is open at all. The outer bound on everybody: a
   * closed day is skipped before any electrician's hours are looked at.
   */
  businessHours: DayHours[];
  /** Days the business set its own hours for, whatever the usual week says. */
  businessDateHours: DateHours[];
  /** The business's own clock, which every date on this screen is read in. */
  timeZone: string;
};

/**
 * Who is on the crew, when they work, and what each of them is doing today.
 *
 * The crew tile linked to the route builder, which answers a
 * different question entirely — how to drive between stops, rather than who is
 * out and where. This is the answer to the question the tile actually asks.
 *
 * Hours and time off come back with the crew rather than being fetched per
 * person as the screen expands them. It is one small business's roster, so it
 * is two more queries rather than two per electrician, and the page can render
 * "Mon–Fri, 8am–5pm" under a name without a round trip.
 */
export async function getTechnicianWorkloads(): Promise<CrewRoster> {
  const context = await resolveContext();
  if (!context) {
    return {
      technicians: [],
      source: "demo",
      canManage: false,
      selfIsElectrician: false,
      businessBlackouts: [],
      // Not `[]`. An empty list is the honest answer to "which days is this
      // business open" only if the answer is none, and rendering the signed-out
      // view as a permanently shut business would be a lie about nobody.
      businessHours: defaultBusinessHours(),
      businessDateHours: [],
      timeZone: DEFAULT_TIMEZONE,
    };
  }

  const { data: auth } = await context.database.auth.getUser();
  const userId = auth.user?.id ?? "";

  const [
    { data: crew },
    { jobs },
    { data: membership },
    { data: hourRows },
    { data: blackoutRows },
    { data: settings },
    { data: dateHourRows },
  ] = await Promise.all([
      context.database
        .from("technicians")
        .select("id, display_name, phone, is_active, user_id")
        .eq("organization_id", context.organizationId)
        .order("display_name"),
      getJobs(),
      context.database
        .from("organization_members")
        .select("role")
        .limit(1)
        .maybeSingle(),
      context.database
        .from("technician_hours")
        .select("technician_id, weekday, starts_at, ends_at")
        .eq("organization_id", context.organizationId),
      context.database
        .from("blackout_periods")
        .select("id, technician_id, starts_at, ends_at, reason")
        .eq("organization_id", context.organizationId)
        // Yesterday's day off is history nobody needs to see on this screen.
        .gte("ends_at", new Date().toISOString())
        .order("starts_at", { ascending: true }),
      context.database
        .from("service_settings")
        .select("business_hours")
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
      context.database
        .from("technician_date_hours")
        .select("technician_id, on_date, starts_at, ends_at")
        .eq("organization_id", context.organizationId)
        // Last month's one-off Saturday cannot be acted on and only makes the
        // list longer, the same reason yesterday's day off is left out above.
        .gte("on_date", todayInZone(context.timeZone))
        .order("on_date", { ascending: true }),
    ]);

  const today = todayInZone(context.timeZone);

  // Dated hours, split the same way blackouts are: a null technician is the
  // business saying it is open that day, not a row that lost its owner.
  const dateHoursByTechnician = new Map<string, DateHours[]>();
  const businessDateHours: DateHours[] = [];

  for (const row of (dateHourRows ?? []) as Record<string, unknown>[]) {
    const entry: DateHours = {
      date: String(row.on_date ?? "").slice(0, 10),
      // Postgres hands back "08:00:00"; every form and label wants "08:00".
      start: String(row.starts_at ?? "").slice(0, 5),
      end: String(row.ends_at ?? "").slice(0, 5),
    };
    if (!entry.date) continue;

    if (typeof row.technician_id !== "string" || row.technician_id === "") {
      businessDateHours.push(entry);
      continue;
    }

    const list = dateHoursByTechnician.get(row.technician_id) ?? [];
    list.push(entry);
    dateHoursByTechnician.set(row.technician_id, list);
  }

  const hoursByTechnician = new Map<string, { weekday: number; start: string; end: string }[]>();
  for (const row of (hourRows ?? []) as Record<string, unknown>[]) {
    const key = String(row.technician_id ?? "");
    const list = hoursByTechnician.get(key) ?? [];
    list.push({
      weekday: Number(row.weekday ?? 0),
      // Postgres hands back "08:00:00"; the form and the label both want "08:00".
      start: String(row.starts_at ?? "").slice(0, 5),
      end: String(row.ends_at ?? "").slice(0, 5),
    });
    hoursByTechnician.set(key, list);
  }

  const blackoutsByTechnician = new Map<string, TechnicianBlackout[]>();
  const businessBlackouts: TechnicianBlackout[] = [];

  for (const row of (blackoutRows ?? []) as Record<string, unknown>[]) {
    const startsAt = String(row.starts_at ?? "");
    const endsAt = String(row.ends_at ?? "");

    const blackout: TechnicianBlackout = {
      id: String(row.id ?? ""),
      startsAt,
      endsAt,
      reason: typeof row.reason === "string" ? row.reason : "",
      label: blackoutLabel(startsAt, endsAt, context.timeZone),
    };

    // No electrician named means the whole business is shut. Keyed under "" by
    // a naive group-by, which would file it against nobody and lose it.
    if (typeof row.technician_id !== "string" || row.technician_id === "") {
      businessBlackouts.push(blackout);
      continue;
    }

    const list = blackoutsByTechnician.get(row.technician_id) ?? [];
    list.push(blackout);
    blackoutsByTechnician.set(row.technician_id, list);
  }

  const technicians: TechnicianWorkload[] = (crew ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const name = typeof record.display_name === "string" ? record.display_name : "";
    const id = String(record.id ?? "");

    return {
      id,
      name,
      initials: initialsOf(name),
      phone: typeof record.phone === "string" ? record.phone : "",
      isActive: record.is_active !== false,
      isMe: Boolean(userId) && record.user_id === userId,
      hours: (hoursByTechnician.get(id) ?? []).sort(
        (a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start),
      ),
      blackouts: blackoutsByTechnician.get(id) ?? [],
      dateHours: dateHoursByTechnician.get(id) ?? [],
      jobs: jobs
        .filter((job) => job.technician === name && job.date === today)
        .map((job) => ({
          id: job.id,
          customer: job.customer,
          time: job.time,
          status: job.status,
          city: job.city,
        })),
    };
  });

  return {
    technicians,
    source: "supabase",
    canManage: ["owner", "admin"].includes(
      typeof membership?.role === "string" ? membership.role : "",
    ),
    selfIsElectrician: technicians.some((technician) => technician.isMe),
    businessBlackouts,
    businessHours: parseBusinessHours(settings?.business_hours),
    businessDateHours,
    timeZone: context.timeZone,
  };
}

/**
 * The crew's availability across a run of dates, for the calendar that shows
 * everybody at once.
 *
 * A sibling of `getTechnicianWorkloads` rather than a caller of it, because that
 * reader is anchored to today on purpose: it drops one-off days before today
 * and time off that has already ended, which keeps the Electricians page short
 * and would make a calendar you can page backwards quietly wrong about the week
 * it is showing. This one takes the window it is asked about.
 *
 * Only `hard` and `private` time off is fetched. `flexible` does not stop the
 * booking page offering a slot, so drawing it as unavailable here would put the
 * calendar and the booking page into disagreement — which is the one thing this
 * screen must never do.
 */
export async function getCrewWeek(
  from: string,
  to: string,
): Promise<{
  people: CrewMember[];
  business: CrewBusiness;
  jobs: PilotJob[];
  timeZone: string;
  source: Source;
}> {
  const context = await resolveContext();
  if (!context) {
    const { jobs } = await getJobs();
    return {
      people: [],
      // Not `[]`: an empty list would draw a business that is shut forever.
      business: { hours: defaultBusinessHours(), dated: [], closures: [] },
      jobs,
      timeZone: DEFAULT_TIMEZONE,
      source: "demo",
    };
  }

  // Time off is stored as instants, so the window has to be one too — midnight
  // to midnight where the business is, not where the server is.
  const windowStart = zonedWallClockToIso(`${from}T00:00`, context.timeZone);
  const windowEnd = zonedWallClockToIso(`${shiftDays(to, 1)}T00:00`, context.timeZone);

  const [{ data: crew }, { jobs }, { data: hourRows }, { data: dateHourRows }, { data: blackoutRows }, { data: settings }] =
    await Promise.all([
      context.database
        .from("technicians")
        .select("id, display_name, is_active")
        .eq("organization_id", context.organizationId)
        .order("display_name"),
      getJobs(),
      context.database
        .from("technician_hours")
        .select("technician_id, weekday, starts_at, ends_at")
        .eq("organization_id", context.organizationId),
      context.database
        .from("technician_date_hours")
        .select("technician_id, on_date, starts_at, ends_at")
        .eq("organization_id", context.organizationId)
        .gte("on_date", from)
        .lte("on_date", to),
      context.database
        .from("blackout_periods")
        .select("technician_id, starts_at, ends_at, reason, block_type")
        .eq("organization_id", context.organizationId)
        .in("block_type", ["hard", "private"])
        // Overlapping the window, which is the same comparison the booking
        // function makes: it starts before the window ends and ends after it
        // began. A date-prefix match would miss a holiday that started last week.
        .lt("starts_at", windowEnd)
        .gt("ends_at", windowStart),
      context.database
        .from("service_settings")
        .select("business_hours")
        .eq("organization_id", context.organizationId)
        .maybeSingle(),
    ]);

  const hoursByTechnician = new Map<string, DayHours[]>();
  for (const row of (hourRows ?? []) as Record<string, unknown>[]) {
    const key = String(row.technician_id ?? "");
    const list = hoursByTechnician.get(key) ?? [];
    list.push({
      weekday: Number(row.weekday ?? 0),
      start: String(row.starts_at ?? "").slice(0, 5),
      end: String(row.ends_at ?? "").slice(0, 5),
    });
    hoursByTechnician.set(key, list);
  }

  const datedByTechnician = new Map<string, DateHours[]>();
  const businessDated: DateHours[] = [];

  for (const row of (dateHourRows ?? []) as Record<string, unknown>[]) {
    const entry: DateHours = {
      date: String(row.on_date ?? "").slice(0, 10),
      start: String(row.starts_at ?? "").slice(0, 5),
      end: String(row.ends_at ?? "").slice(0, 5),
    };
    if (!entry.date) continue;

    // A null technician is the business, the same split the roster reader makes.
    if (typeof row.technician_id !== "string" || row.technician_id === "") {
      businessDated.push(entry);
      continue;
    }

    const list = datedByTechnician.get(row.technician_id) ?? [];
    list.push(entry);
    datedByTechnician.set(row.technician_id, list);
  }

  const timeOffByTechnician = new Map<string, CrewTimeOff[]>();
  const closures: CrewTimeOff[] = [];

  for (const row of (blackoutRows ?? []) as Record<string, unknown>[]) {
    const startsAt = String(row.starts_at ?? "");
    const endsAt = String(row.ends_at ?? "");
    if (!startsAt || !endsAt) continue;

    const reason = typeof row.reason === "string" && row.reason ? row.reason : "";
    const label = reason || blackoutLabel(startsAt, endsAt, context.timeZone);
    const entry: CrewTimeOff = { startsAt, endsAt, label };

    if (typeof row.technician_id !== "string" || row.technician_id === "") {
      closures.push(entry);
      continue;
    }

    const list = timeOffByTechnician.get(row.technician_id) ?? [];
    list.push(entry);
    timeOffByTechnician.set(row.technician_id, list);
  }

  const people: CrewMember[] = (crew ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const id = String(record.id ?? "");
    const name = typeof record.display_name === "string" ? record.display_name : "";

    return {
      id,
      name,
      initials: initialsOf(name),
      isActive: record.is_active !== false,
      hours: (hoursByTechnician.get(id) ?? []).sort((a, b) => a.weekday - b.weekday),
      dateHours: datedByTechnician.get(id) ?? [],
      timeOff: timeOffByTechnician.get(id) ?? [],
    };
  });

  return {
    people,
    business: {
      hours: parseBusinessHours(settings?.business_hours),
      dated: businessDated,
      closures,
    },
    jobs,
    timeZone: context.timeZone,
    source: "supabase",
  };
}

/**
 * What has happened on one job, for the history at the bottom of its page.
 *
 * Keyed on the job number, because that is what the URL carries and what the
 * page already has. Returns the timezone alongside, so the caller never has to
 * guess which day an evening's work belongs to.
 */
export async function getJobHistory(
  jobNumber: string,
): Promise<{ rows: ActivityRow[]; timeZone: string }> {
  const context = await resolveContext();
  const numeric = Number(jobNumber);
  if (!context || !Number.isFinite(numeric)) {
    return { rows: [], timeZone: DEFAULT_TIMEZONE };
  }

  const { data: job } = await context.database
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!job?.id) return { rows: [], timeZone: context.timeZone };

  const { data } = await context.database
    .from("activity_events")
    .select("id, event_type, label, created_at, metadata")
    .eq("organization_id", context.organizationId)
    .eq("job_id", String(job.id))
    .order("created_at", { ascending: false })
    .limit(40);

  return {
    // No `jobId` on these: every one of them is this job, and a list of links
    // back to the page you are already on is not navigation.
    rows: ((data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id ?? ""),
      eventType: String(row.event_type ?? ""),
      label: String(row.label ?? ""),
      createdAt: String(row.created_at ?? ""),
      metadata: (row.metadata ?? {}) as Record<string, unknown>,
    })),
    timeZone: context.timeZone,
  };
}

/** "Fri 21 Aug" for a whole day, "Fri 21 Aug, 1pm–5pm" for part of one. */
function blackoutLabel(startsAt: string, endsAt: string, timeZone: string): string {
  if (!startsAt || !endsAt) return "";

  const day = inZone(startsAt, timeZone, { weekday: "short", month: "short", day: "numeric" });
  const endDay = inZone(endsAt, timeZone, { weekday: "short", month: "short", day: "numeric" });

  const startClock = inZone(startsAt, timeZone, { hour: "numeric", minute: "2-digit" });
  const endClock = inZone(endsAt, timeZone, { hour: "numeric", minute: "2-digit" });

  // Saved as 00:00 to 23:59, which is this screen's way of writing "all day".
  const wholeDay = startClock.startsWith("12:00 AM") && endClock.startsWith("11:59 PM");

  if (day !== endDay) return wholeDay ? `${day} – ${endDay}` : `${day} ${startClock} – ${endDay} ${endClock}`;
  return wholeDay ? day : `${day}, ${startClock}–${endClock}`;
}

/**
 * Place any of this business's addresses that have never been placed.
 *
 * Run before the route map so stops have coordinates to be drawn at. Silent and
 * free when there is nothing to do, which is the usual case after the first
 * time an address is seen.
 */
export async function placeTodaysStops(): Promise<{
  placed: number;
  unplaced: { address: string; reason: string }[];
}> {
  const context = await resolveContext();
  if (!context) return { placed: 0, unplaced: [] };

  const { ensurePropertiesGeocoded } = await import("@/lib/geocoding");
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");

  return ensurePropertiesGeocoded({
    database: getSupabaseAdmin(),
    organizationId: context.organizationId,
  });
}

export type JobContract = {
  id: string;
  createdLabel: string;
  body: string;
  unfilled: string[];
  /** The stored PDF, or empty when one has not been built yet. */
  document: { url: string; fileName: string; versionNumber: number } | null;
};

/**
 * The contracts already generated for a job.
 *
 * Read through the caller's session, so RLS decides which business's contracts
 * these are. Newest first: the last draft is the one somebody is about to send.
 *
 * The PDFs come with them, signed in one batch. Every draft gets its document,
 * not just the newest: an electrician comparing what they sent last week with
 * what they are about to send needs to open both, and a superseded draft that
 * can only be read as plain text is the thing this replaced.
 */
export async function getJobContracts(jobNumber: string): Promise<JobContract[]> {
  const context = await resolveContext();
  if (!context) return [];

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return [];

  const { data: job } = await context.database
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  const jobId = typeof job?.id === "string" ? job.id : "";
  if (!jobId) return [];

  const { data } = await context.database
    .from("contracts")
    .select("id, body, unfilled, created_at")
    .eq("organization_id", context.organizationId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = (data ?? []) as Record<string, unknown>[];

  const { currentDocuments } = await import("@/lib/pdf/store");
  const stored = await currentDocuments({
    database: context.database,
    organizationId: context.organizationId,
    column: "contract_id",
    ids: rows.map((row) => String(row.id)),
    timeZone: context.timeZone,
  });

  return rows.map((row) => {
    const id = String(row.id);
    const document = stored.get(id) ?? null;

    return {
      id,
      body: typeof row.body === "string" ? row.body : "",
      unfilled: Array.isArray(row.unfilled) ? (row.unfilled as string[]) : [],
      createdLabel: inZone(row.created_at as string | null, context.timeZone, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }),
      document: document
        ? {
            url: document.url,
            fileName: document.fileName,
            versionNumber: document.versionNumber,
          }
        : null,
    };
  });
}

/**
 * The business's stock, newest names first.
 *
 * Read through the caller's session, so RLS decides whose stock this is.
 * Returns an empty list rather than fixtures — a business with no stock list
 * has no stock list, and inventing one would make the materials page claim
 * parts are on the van that are not.
 */
export async function getInventory(): Promise<
  {
    id: string;
    name: string;
    partNumber: string;
    quantity: number;
    unit: string;
    supplier: string;
    unitCost: number | null;
    location: string;
    notes: string;
    photoUrl: string;
  }[]
> {
  const context = await resolveContext();
  if (!context) return [];

  const { data } = await context.database
    .from("inventory_items")
    .select("id, name, sku, category, quantity_on_hand, reorder_point, unit, supplier, unit_cost_cents, location, notes, photo_url, photo_path")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  const rows = (data ?? []) as Record<string, unknown>[];

  /*
   * An uploaded photo is an object in a private bucket, so it needs signing
   * before a browser can render it. Signed in one batch rather than one call
   * per row: a van's stock list is thirty parts, and thirty round trips to sign
   * thirty thumbnails is the page.
   */
  const photos = await signStockPhotos(
    rows.map((row) => (typeof row.photo_path === "string" ? row.photo_path : "")),
  );

  return rows.map((row) => ({
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    partNumber: typeof row.sku === "string" ? row.sku : "",
    quantity: Number(row.quantity_on_hand ?? 0),
    unit: typeof row.unit === "string" ? row.unit : "each",
    supplier: typeof row.supplier === "string" ? row.supplier : "",
    // The column is NOT NULL default 0, so zero means "not recorded" rather
    // than "free" — showing $0.00 against every part would be worse than blank.
    unitCost: Number(row.unit_cost_cents ?? 0) > 0 ? Number(row.unit_cost_cents) / 100 : null,
    location: typeof row.location === "string" ? row.location : "",
    notes: typeof row.notes === "string" ? row.notes : "",
    /*
     * An uploaded photo wins over a pasted link.
     *
     * `photo_url` is the old free-text box and holds a picture somewhere on the
     * web; `photo_path` is a file the electrician took. When both exist the one
     * they took is the one they meant.
     */
    photoUrl:
      photos.get(typeof row.photo_path === "string" ? row.photo_path : "") ||
      (typeof row.photo_url === "string" ? row.photo_url : ""),
  }));
}

export type StockMovementRow = {
  id: string;
  quantity: number;
  reason: string;
  unitCostCents: number;
  note: string;
  jobNumber: string;
  /** Where to open the receipt this came in on, or "" when it did not. */
  receiptHref: string;
  whenLabel: string;
};

export type StockItemDetail = {
  id: string;
  name: string;
  partNumber: string;
  quantity: number;
  unit: string;
  supplier: string;
  unitCost: number | null;
  location: string;
  notes: string;
  photoUrl: string;
  movements: StockMovementRow[];
  /** Cents. What has left on jobs, at the price it left at. */
  spentCents: number;
};

/**
 * One part, with the history that explains its number.
 *
 * The history is the point. "Seventeen" on its own is a claim; "twenty came in
 * on the 3rd, three went out on job 1045" is a number somebody can argue with,
 * which is what makes a stock list worth keeping.
 */
export async function getInventoryItem(id: string): Promise<StockItemDetail | null> {
  const context = await resolveContext();
  if (!context) return null;

  const { data } = await context.database
    .from("inventory_items")
    .select(
      "id, name, sku, quantity_on_hand, unit, supplier, unit_cost_cents, location, notes, photo_url, photo_path",
    )
    .eq("id", id)
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .maybeSingle();

  const row = (data ?? null) as Record<string, unknown> | null;
  if (!row) return null;

  const { data: history } = await context.database
    .from("inventory_movements")
    .select(
      "id, quantity, reason, unit_cost_cents, note, created_at, jobs ( job_number ), documents ( id, folder_id )",
    )
    .eq("item_id", id)
    .eq("organization_id", context.organizationId)
    .order("created_at", { ascending: false })
    .limit(100);

  const photos = await signStockPhotos([
    typeof row.photo_path === "string" ? row.photo_path : "",
  ]);

  const movements = ((history ?? []) as Record<string, unknown>[]).map((entry) => {
    const job = (entry.jobs ?? null) as { job_number?: unknown } | null;
    // The scanned receipt this arrived on, when it arrived on one. Both halves
    // are needed to link to it: files open inside the folder that holds them.
    const receipt = (entry.documents ?? null) as {
      id?: unknown;
      folder_id?: unknown;
    } | null;

    return {
      id: String(entry.id),
      quantity: Number(entry.quantity ?? 0),
      reason: typeof entry.reason === "string" ? entry.reason : "adjustment",
      unitCostCents: Number(entry.unit_cost_cents ?? 0),
      note: typeof entry.note === "string" ? entry.note : "",
      jobNumber: job?.job_number ? String(job.job_number) : "",
      receiptHref:
        typeof receipt?.id === "string" && typeof receipt?.folder_id === "string"
          ? `/files/${receipt.folder_id}?open=${receipt.id}`
          : "",
      whenLabel: inZone(
        typeof entry.created_at === "string" ? entry.created_at : null,
        context.timeZone,
        { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" },
      ),
    };
  });

  return {
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    partNumber: typeof row.sku === "string" ? row.sku : "",
    quantity: Number(row.quantity_on_hand ?? 0),
    unit: typeof row.unit === "string" ? row.unit : "each",
    supplier: typeof row.supplier === "string" ? row.supplier : "",
    unitCost: Number(row.unit_cost_cents ?? 0) > 0 ? Number(row.unit_cost_cents) / 100 : null,
    location: typeof row.location === "string" ? row.location : "",
    notes: typeof row.notes === "string" ? row.notes : "",
    photoUrl:
      photos.get(typeof row.photo_path === "string" ? row.photo_path : "") ||
      (typeof row.photo_url === "string" ? row.photo_url : ""),
    movements,
    spentCents: movements.reduce(
      (sum, movement) =>
        movement.quantity < 0 ? sum + Math.abs(movement.quantity) * movement.unitCostCents : sum,
      0,
    ),
  };
}

/** Long enough to render a list, short enough not to be worth passing on. */
const STOCK_PHOTO_SECONDS = 60 * 60;

/**
 * Signed links for a page full of stock photos, in one round trip.
 *
 * The bucket is private — an object path is not a URL anyone can open, which is
 * the point. Signing them one at a time is thirty round trips for a van's worth
 * of parts, so they go in a batch and anything that fails comes back missing
 * rather than breaking the list.
 */
async function signStockPhotos(paths: string[]): Promise<Map<string, string>> {
  const wanted = [...new Set(paths.filter(Boolean))];
  const signed = new Map<string, string>();
  if (wanted.length === 0) return signed;

  try {
    const admin = getSupabaseAdmin();
    const { data, error } = await admin.storage
      .from(DOCUMENTS_BUCKET)
      .createSignedUrls(wanted, STOCK_PHOTO_SECONDS);

    if (error) {
      console.error("stock photos: could not be signed", error);
      return signed;
    }

    for (const entry of data ?? []) {
      if (entry.path && entry.signedUrl) signed.set(entry.path, entry.signedUrl);
    }
  } catch (error) {
    // No service key configured, most likely. A list with no thumbnails is a
    // list; a crashed page is not.
    console.error("stock photos: storage is not reachable", error);
  }

  return signed;
}

export type SupplyStopRow = {
  id: string;
  name: string;
  kind: string;
  address: string;
  city: string;
  state: string;
  postalCode: string;
  notes: string;
  isDefault: boolean;
  coordinates: { lat: number; lng: number } | null;
};

/**
 * The places this business stops on the way.
 *
 * Empty is a real answer and the honest one: a business that has not said where
 * it buys things has not said, and offering it a Lowe's in Santa Maria because
 * that is what the pilot used is how somebody ends up routed forty miles the
 * wrong way.
 */
export async function getSupplyStops(): Promise<SupplyStopRow[]> {
  const context = await resolveContext();
  if (!context) return [];

  const { data } = await context.database
    .from("supply_stops")
    .select(
      "id, name, kind, address_line_1, city, state, postal_code, notes, is_default, latitude, longitude",
    )
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    // The default first, then alphabetical: the one you usually use should be
    // the one your thumb lands on.
    .order("is_default", { ascending: false })
    .order("name", { ascending: true });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    name: typeof row.name === "string" ? row.name : "",
    kind: typeof row.kind === "string" ? row.kind : "supplier",
    address: typeof row.address_line_1 === "string" ? row.address_line_1 : "",
    city: typeof row.city === "string" ? row.city : "",
    state: typeof row.state === "string" ? row.state : "",
    postalCode: typeof row.postal_code === "string" ? row.postal_code : "",
    notes: typeof row.notes === "string" ? row.notes : "",
    isDefault: row.is_default === true,
    coordinates: hasCoordinates({
      lat: row.latitude === null || row.latitude === undefined ? null : Number(row.latitude),
      lng: row.longitude === null || row.longitude === undefined ? null : Number(row.longitude),
    })
      ? { lat: Number(row.latitude), lng: Number(row.longitude) }
      : null,
  }));
}
