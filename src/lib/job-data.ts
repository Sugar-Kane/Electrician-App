import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { formatDayLabel, isoDateInZone, shiftDays, todayInZone, workWeekStart } from "@/lib/calendar";
import { currentContext } from "@/lib/request-context";
import { isoToZonedWallClock } from "@/lib/schedule-labels";
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
 * Not yet backed by the database: job documents and per-job materials. There
 * are no tables for either, so those fields come through empty rather than
 * showing another job's mock attachments.
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
  needs_review: "Pending",
  canceled: "Pending",
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
    workType: row.category ?? "service",
    summary: row.customer_description ?? row.ai_summary ?? "",
    status: JOB_STATUS[row.status] ?? "Pending",
    technician: technicianName,
    technicianInitials: initialsOf(technicianName),
    accessNotes: property.access_notes ?? "",
    serviceNotes: row.ai_summary ?? "",
    coordinates: {
      lat: Number(property.latitude ?? 0),
      lng: Number(property.longitude ?? 0),
    },
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
  technicians ( display_name )
`;

export async function getJobs(): Promise<{ jobs: PilotJob[]; source: Source }> {
  const context = await resolveContext();
  if (!context) return { jobs: rebaseDemoJobs(pilotJobs, DEFAULT_TIMEZONE), source: "demo" };

  const { data, error } = await context.database
    .from("jobs")
    .select(JOB_SELECT)
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("scheduled_start", { ascending: true });

  if (error || !data?.length) {
    return { jobs: rebaseDemoJobs(pilotJobs, context.timeZone), source: "demo" };
  }
  return { jobs: data.map((row) => mapJob(row, context.timeZone)), source: "supabase" };
}

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

  if (error || !data) {
    const jobs = rebaseDemoJobs(pilotJobs, context.timeZone);
    return { job: jobs.find((j) => j.id === id) ?? null, source: "demo" };
  }
  return { job: mapJob(data, context.timeZone), source: "supabase" };
}

export async function getInvoices(): Promise<{ invoices: PilotInvoice[]; source: Source }> {
  const context = await resolveContext();
  if (!context) return { invoices: pilotInvoices, source: "demo" };

  const { data, error } = await context.database
    .from("invoices")
    .select(`
      id, invoice_number, status, total_cents, balance_due_cents, due_at,
      jobs ( job_number, customers ( first_name, last_name, company_name ) )
    `)
    .eq("organization_id", context.organizationId)
    .order("due_at", { ascending: true });

  if (error || !data?.length) return { invoices: pilotInvoices, source: "demo" };

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
  canceled: boolean;
  cancellationReason: string;
  customerPhone: string;
  customerEmail: string;
} | null> {
  const context = await resolveContext();
  if (!context) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await context.database
    .from("jobs")
    .select(
      `job_number, status, canceled_at, cancellation_reason,
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
    canceled: str(row.status) === "canceled",
    cancellationReason: str(row.cancellation_reason),
    customerPhone: str(customer?.phone),
    customerEmail: str(customer?.email),
  };
}
