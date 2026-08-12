import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { formatDayLabel, isoDateInZone, shiftDays, todayInZone, workWeekStart } from "@/lib/calendar";
import { hasCoordinates } from "@/lib/coordinates";
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

  // A real business with no jobs has no jobs. Falling back to the pilot
  // fixtures here is what put four invented customers in front of an
  // electrician who had just signed up, with no way to tell which of their
  // records were real.
  if (error) return { jobs: [], source: "supabase" };
  return { jobs: (data ?? []).map((row) => mapJob(row, context.timeZone)), source: "supabase" };
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
    canceled: str(row.status) === "canceled",
    cancellationReason: str(row.cancellation_reason),
    customerPhone: str(customer?.phone),
    customerEmail: str(customer?.email),
    technicianNotes: str(row.technician_notes),
  };
}

export type TechnicianWorkload = {
  id: string;
  name: string;
  initials: string;
  phone: string;
  isActive: boolean;
  jobs: { id: string; customer: string; time: string; status: JobStatus; city: string }[];
};

/**
 * Who is on the crew, and what each of them is doing today.
 *
 * The "Techs working" tile linked to the route builder, which answers a
 * different question entirely — how to drive between stops, rather than who is
 * out and where. This is the answer to the question the tile actually asks.
 */
export async function getTechnicianWorkloads(): Promise<{
  technicians: TechnicianWorkload[];
  source: Source;
}> {
  const context = await resolveContext();
  if (!context) return { technicians: [], source: "demo" };

  const [{ data: crew }, { jobs }] = await Promise.all([
    context.database
      .from("technicians")
      .select("id, display_name, phone, is_active")
      .eq("organization_id", context.organizationId)
      .order("display_name"),
    getJobs(),
  ]);

  const today = todayInZone(context.timeZone);

  const technicians: TechnicianWorkload[] = (crew ?? []).map((row) => {
    const record = row as Record<string, unknown>;
    const name = typeof record.display_name === "string" ? record.display_name : "";

    return {
      id: String(record.id ?? ""),
      name,
      initials: initialsOf(name),
      phone: typeof record.phone === "string" ? record.phone : "",
      isActive: record.is_active !== false,
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

  return { technicians, source: "supabase" };
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

/**
 * The contracts already generated for a job.
 *
 * Read through the caller's session, so RLS decides which business's contracts
 * these are. Newest first: the last draft is the one somebody is about to send.
 */
export async function getJobContracts(jobNumber: string): Promise<
  { id: string; createdLabel: string; body: string; unfilled: string[] }[]
> {
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

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: String(row.id),
    body: typeof row.body === "string" ? row.body : "",
    unfilled: Array.isArray(row.unfilled) ? (row.unfilled as string[]) : [],
    createdLabel: inZone(row.created_at as string | null, context.timeZone, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }),
  }));
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
    .select("id, name, sku, category, quantity_on_hand, reorder_point, unit, supplier, unit_cost_cents, location, notes, photo_url")
    .eq("organization_id", context.organizationId)
    .is("archived_at", null)
    .order("name", { ascending: true });

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
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
    photoUrl: typeof row.photo_url === "string" ? row.photo_url : "",
  }));
}
