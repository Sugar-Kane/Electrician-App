import { jobCategoryLabel } from "./new-job-input.ts";
import { addDays, calendarDate, zonedWallClockToIso } from "./schedule-labels.ts";
import type { FlexibleSupabaseClient } from "./supabase/flexible.ts";

/**
 * A day's jobs, for ChatGPT's today_plan. What
 * needs doing is "Needs your action" (needs-action.ts), the home screen's own
 * list.
 *
 * No server-only imports, so the tools that use it stay testable.
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

/** The jobs of one day in the business's time zone, earliest first. */
export async function dayJobs(db: Database, organizationId: string, timeZone: string, date?: string): Promise<{ date: string; today: string; jobs: Row[] }> {
  const today = calendarDate(new Date().toISOString(), timeZone);
  const day = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : today;
  const { start, end } = dayBounds(day, timeZone);
  return { date: day, today, jobs: await jobsBetween(db, organizationId, start, end) };
}
