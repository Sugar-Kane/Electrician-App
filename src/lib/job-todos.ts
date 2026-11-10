import { invoiceState } from "./dashboard-metrics.ts";
import { formatMoney } from "./invoice-messages.ts";
import { jobCategoryLabel } from "./new-job-input.ts";
import { addDays, calendarDate, zonedWallClockToIso } from "./schedule-labels.ts";
import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";

/**
 * What the jobs say needs doing, worked out fresh from the jobs, invoices and
 * booking requests themselves: the day's jobs, finished work not billed,
 * invoices not sent or overdue, booking requests to answer, and coming jobs
 * with nothing priced.
 *
 * Nothing is copied into tasks, so it can never go stale: when a job is
 * billed or a request answered, it simply stops being listed. The Tasks page,
 * ChatGPT's daily list and today_plan all read it from here.
 *
 * No server-only imports, so the task tools that use it stay testable.
 */

type Database = FlexibleSupabaseClient;
type Row = Record<string, unknown>;

export const JOB_FIELDS =
  "id, job_number, status, category, customer_description, scheduled_start, scheduled_end, arrival_window_start, arrival_window_end, materials_ready_at, customers(first_name,last_name,company_name,phone), properties(address_line_1,address_line_2,city,state,postal_code,access_notes), job_line_items(id)";

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function record(value: unknown): Row {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Row) : {};
}

function money(cents: number): string {
  return formatMoney(cents / 100);
}

export function displayCustomer(customer: Row): string {
  return text(customer.company_name) || [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ") || "Customer";
}

/** Midnight to midnight, where the business is. */
export function dayBounds(date: string, timeZone: string): { start: string; end: string } {
  return {
    start: zonedWallClockToIso(`${date}T00:00`, timeZone),
    end: zonedWallClockToIso(`${addDays(date, 1)}T00:00`, timeZone),
  };
}

/** Jobs that start between two instants, earliest first. Called-off ones are left out. */
export async function jobsBetween(db: Database, organizationId: string, fromIso: string, toIso: string): Promise<Row[]> {
  const { data } = await db
    .from("jobs")
    .select(JOB_FIELDS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .gte("scheduled_start", fromIso)
    .lt("scheduled_start", toIso)
    .not("status", "in", "(canceled,no_show)")
    .order("scheduled_start", { ascending: true })
    .limit(200);
  return (data ?? []) as Row[];
}

export function timeLabel(iso: string, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

export type DayJob = {
  id: string;
  number: string;
  window: string;
  customer: string;
  phone: string;
  address: string;
  work: string;
  kind: string;
  status: string;
  partsReady: boolean;
  pricedItems: number;
  accessNotes: string;
  href: string;
};

export function dayJob(job: Row, timeZone: string): DayJob {
  const customer = record(job.customers);
  const place = record(job.properties);
  const start = text(job.arrival_window_start) || text(job.scheduled_start);
  const end = text(job.arrival_window_end) || text(job.scheduled_end);
  return {
    id: text(job.id),
    number: text(job.job_number),
    window: start ? `${timeLabel(start, timeZone)}${end ? `–${timeLabel(end, timeZone)}` : ""}` : "no time set",
    customer: displayCustomer(customer),
    phone: text(customer.phone),
    address: [text(place.address_line_1), text(place.address_line_2), text(place.city)].filter(Boolean).join(", "),
    work: text(job.customer_description).slice(0, 200),
    kind: jobCategoryLabel(text(job.category)),
    status: text(job.status).replace(/_/g, " "),
    partsReady: Boolean(text(job.materials_ready_at)),
    pricedItems: Array.isArray(job.job_line_items) ? job.job_line_items.length : 0,
    accessNotes: text(place.access_notes).slice(0, 160),
    href: `/jobs/${text(job.job_number)}`,
  };
}

export type JobTodo = {
  kind: "bill_job" | "send_invoice" | "chase_invoice" | "answer_request" | "price_job";
  title: string;
  /** Where in Volteira it gets done. */
  href: string;
  jobNumber: string | null;
  /** A hint for ChatGPT on which tool does it. */
  tool: string | null;
};

/** The day's jobs and the job to-dos, for one date in the business's time zone. */
export async function jobTodos(
  db: Database,
  organizationId: string,
  timeZone: string,
  date?: string,
): Promise<{ date: string; today: string; jobs: Row[]; todos: JobTodo[] }> {
  const today = calendarDate(new Date().toISOString(), timeZone);
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const { start, end } = dayBounds(day, timeZone);

  const [jobs, unbilled, invoices, requests, coming] = await Promise.all([
    jobsBetween(db, organizationId, start, end),
    db
      .from("job_line_items")
      .select("quantity, unit_price_cents, jobs!inner(job_number, status, archived_at, customers(first_name,last_name,company_name))")
      .eq("organization_id", organizationId)
      .is("invoice_id", null)
      .eq("jobs.status", "completed")
      .is("jobs.archived_at", null)
      .limit(500),
    db
      .from("invoices")
      .select("id, invoice_number, status, due_at, last_sent_at, balance_due_cents, total_cents, jobs(job_number, customers(first_name,last_name,company_name))")
      .eq("organization_id", organizationId)
      .not("status", "in", "(paid,void)")
      .order("created_at", { ascending: false })
      .limit(200),
    db
      .from("booking_requests")
      .select("contact_name, phone, description, created_at, source")
      .eq("organization_id", organizationId)
      .in("status", ["new", "needs_review"])
      .order("created_at", { ascending: false })
      .limit(20),
    jobsBetween(db, organizationId, end, zonedWallClockToIso(`${addDays(day, 4)}T00:00`, timeZone)),
  ]);

  const todos: JobTodo[] = [];

  // Finished work with lines nobody has billed: money not yet asked for.
  const toBill = new Map<string, { customer: string; cents: number }>();
  for (const line of (unbilled.data ?? []) as Row[]) {
    const job = record(line.jobs);
    const key = text(job.job_number);
    const entry = toBill.get(key) ?? { customer: displayCustomer(record(job.customers)), cents: 0 };
    entry.cents += Math.round(Number(line.quantity ?? 0) * Number(line.unit_price_cents ?? 0));
    toBill.set(key, entry);
  }
  for (const [number, entry] of toBill) {
    todos.push({ kind: "bill_job", title: `Bill job #${number} (${entry.customer}): ${money(entry.cents)} finished and not invoiced.`, href: `/jobs/${number}`, jobNumber: number, tool: "bill_job" });
  }

  for (const row of (invoices.data ?? []) as Row[]) {
    const job = record(row.jobs);
    const who = displayCustomer(record(job.customers));
    const state = invoiceState({
      status: text(row.status),
      dueAt: text(row.due_at) || null,
      balanceDueCents: Number(row.balance_due_cents ?? 0),
      lastSentAt: text(row.last_sent_at) || null,
    });
    if (state === "draft") {
      todos.push({
        kind: "send_invoice",
        title: `Send INV-${text(row.invoice_number)} (${who}, job #${text(job.job_number)}): ${money(Number(row.total_cents ?? 0))} drafted, not sent. If they already paid in hand, mark it paid instead.`,
        href: `/invoices/${text(row.id)}`,
        jobNumber: text(job.job_number) || null,
        tool: "send_invoice or mark_invoice_paid",
      });
    } else if (state === "overdue") {
      todos.push({
        kind: "chase_invoice",
        title: `Chase INV-${text(row.invoice_number)} (${who}): ${money(Number(row.balance_due_cents ?? 0))} overdue.`,
        href: `/invoices/${text(row.id)}`,
        jobNumber: text(job.job_number) || null,
        tool: "send_invoice",
      });
    }
  }

  for (const request of (requests.data ?? []) as Row[]) {
    todos.push({
      kind: "answer_request",
      title: `Answer booking request from ${text(request.contact_name) || text(request.phone) || "a customer"}: ${text(request.description).slice(0, 140)}`,
      href: "/booking-requests",
      jobNumber: null,
      tool: null,
    });
  }

  for (const job of [...jobs, ...coming]) {
    const lines = Array.isArray(job.job_line_items) ? job.job_line_items.length : 0;
    if (lines === 0 && text(job.category) !== "diagnostic") {
      todos.push({
        kind: "price_job",
        title: `Price job #${text(job.job_number)} (${displayCustomer(record(job.customers))}): no materials or labor on it yet.`,
        href: `/jobs/${text(job.job_number)}`,
        jobNumber: text(job.job_number),
        tool: "add_job_lines",
      });
    }
  }

  return { date: day, today, jobs, todos };
}
