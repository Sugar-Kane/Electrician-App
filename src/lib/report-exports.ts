import "server-only";

import { dollars } from "@/lib/csv";
import { INVOICE_STATE_LABELS, invoiceState } from "@/lib/dashboard-metrics";
import { jobCategoryLabel } from "@/lib/new-job-input";
import { addDays, zonedWallClockToIso } from "@/lib/schedule-labels";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * The records behind each report, as rows for a spreadsheet.
 *
 * Read through the signed-in person's own session, so the database's own
 * rules decide which business's records come back, and filtered to that
 * business as well. Money is in dollars as plain numbers, so a spreadsheet can
 * add it up; dates and times are in the business's time zone.
 */

export const REPORT_EXPORTS = {
  payments: { title: "Payments received", file: "payments", note: "Every payment recorded in the dates you pick: invoice payments and booking deposits." },
  invoices: { title: "Invoices", file: "invoices", note: "Invoices made in the dates you pick, with what is still owed and how overdue." },
  jobs: { title: "Jobs", file: "jobs", note: "Jobs created in the dates you pick, with labor, materials and what was invoiced." },
  customers: { title: "Customers", file: "customers", note: "Your whole customer list, with what each has been invoiced and still owes." },
  activity: { title: "Activity", file: "activity", note: "What happened, in the dates you pick." },
} as const;

export type ReportExportKey = keyof typeof REPORT_EXPORTS;

export function isReportExportKey(value: string): value is ReportExportKey {
  return Object.hasOwn(REPORT_EXPORTS, value);
}

type Table = { headers: string[]; rows: unknown[][] };

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" ? String(value) : "";
}

function one(value: unknown): Record<string, unknown> {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : {};
}

function rows(data: unknown): Record<string, unknown>[] {
  return Array.isArray(data) ? (data as Record<string, unknown>[]) : [];
}

function person(row: Record<string, unknown>): string {
  return text(row.company_name) || [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ");
}

/** "2026-11-05 14:03" in the business's zone, or blank. */
function when(iso: unknown, timeZone: string): string {
  const value = text(iso);
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const part = (type: string) => parts.find((entry) => entry.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")} ${part("hour") === "24" ? "00" : part("hour")}:${part("minute")}`;
}

function day(iso: unknown, timeZone: string): string {
  return when(iso, timeZone).slice(0, 10);
}

/** Midnight at the start of `from` to midnight after `to`, where the business is. */
function bounds(range: { from: string; to: string }, timeZone: string) {
  return {
    start: zonedWallClockToIso(`${range.from}T00:00`, timeZone),
    end: zonedWallClockToIso(`${addDays(range.to, 1)}T00:00`, timeZone),
  };
}

const PAGE = 1000;

/** Every row of a query, a page at a time, up to a ceiling no business will reach by accident. */
async function all(query: (from: number, to: number) => PromiseLike<{ data: unknown }>): Promise<Record<string, unknown>[]> {
  const found: Record<string, unknown>[] = [];
  for (let from = 0; from < 50_000; from += PAGE) {
    const { data } = await query(from, from + PAGE - 1);
    const page = rows(data);
    found.push(...page);
    if (page.length < PAGE) break;
  }
  return found;
}

export async function buildReportExport(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  report: ReportExportKey;
  range: { from: string; to: string };
  timeZone: string;
}): Promise<Table> {
  const { database: db, organizationId: org, report, range, timeZone } = input;
  const { start, end } = bounds(range, timeZone);

  if (report === "payments") {
    const [invoicePayments, deposits] = await Promise.all([
      all((from, to) =>
        db.from("invoice_payments")
          .select("recorded_at, method, amount_cents, note, invoices(invoice_number), jobs(job_number, customers(first_name,last_name,company_name))")
          .eq("organization_id", org).gte("recorded_at", start).lt("recorded_at", end)
          .order("recorded_at", { ascending: true }).range(from, to)),
      all((from, to) =>
        db.from("payments")
          .select("paid_at, provider, amount_cents, status, jobs(job_number, customers(first_name,last_name,company_name)), booking_requests(contact_name)")
          .eq("organization_id", org).eq("status", "paid").gte("paid_at", start).lt("paid_at", end)
          .order("paid_at", { ascending: true }).range(from, to)),
    ]);
    const lines = [
      ...invoicePayments.map((row) => {
        const job = one(row.jobs);
        return {
          at: text(row.recorded_at),
          cells: [when(row.recorded_at, timeZone), "Invoice payment", text(row.method), dollars(row.amount_cents),
            one(row.invoices).invoice_number ? `INV-${text(one(row.invoices).invoice_number)}` : "",
            job.job_number ? `#${text(job.job_number)}` : "", person(one(job.customers)), text(row.note)],
        };
      }),
      ...deposits.map((row) => {
        const job = one(row.jobs);
        return {
          at: text(row.paid_at),
          cells: [when(row.paid_at, timeZone), "Booking deposit", text(row.provider), dollars(row.amount_cents), "",
            job.job_number ? `#${text(job.job_number)}` : "", person(one(job.customers)) || text(one(row.booking_requests).contact_name), ""],
        };
      }),
    ].sort((a, b) => a.at.localeCompare(b.at));
    return {
      headers: ["Date", "Type", "Method", "Amount ($)", "Invoice", "Job", "Customer", "Note"],
      rows: lines.map((line) => line.cells),
    };
  }

  if (report === "invoices") {
    const found = await all((from, to) =>
      db.from("invoices")
        .select("invoice_number, created_at, status, subtotal_cents, diagnostic_credit_cents, tax_cents, total_cents, balance_due_cents, due_at, last_sent_at, paid_at, jobs(job_number, customers(first_name,last_name,company_name))")
        .eq("organization_id", org).gte("created_at", start).lt("created_at", end)
        .order("invoice_number", { ascending: true }).range(from, to));
    const now = new Date();
    return {
      headers: ["Invoice", "Created", "Status", "Customer", "Job", "Subtotal ($)", "Diagnostic credit ($)", "Tax ($)", "Total ($)", "Balance due ($)", "Due", "Last sent", "Paid", "Days overdue"],
      rows: found.map((row) => {
        const job = one(row.jobs);
        const state = invoiceState({
          status: text(row.status),
          dueAt: text(row.due_at) || null,
          balanceDueCents: Number(row.balance_due_cents ?? 0),
          lastSentAt: text(row.last_sent_at) || null,
        }, now);
        const overdue = state === "overdue" && text(row.due_at)
          ? Math.floor((now.getTime() - new Date(text(row.due_at)).getTime()) / 86_400_000)
          : "";
        return [`INV-${text(row.invoice_number)}`, day(row.created_at, timeZone), INVOICE_STATE_LABELS[state],
          person(one(job.customers)), job.job_number ? `#${text(job.job_number)}` : "",
          dollars(row.subtotal_cents), dollars(row.diagnostic_credit_cents), dollars(row.tax_cents), dollars(row.total_cents),
          dollars(row.balance_due_cents), day(row.due_at, timeZone), day(row.last_sent_at, timeZone), day(row.paid_at, timeZone), overdue];
      }),
    };
  }

  if (report === "jobs") {
    const found = await all((from, to) =>
      db.from("jobs")
        .select("job_number, created_at, category, status, scheduled_start, customer_description, customers(first_name,last_name,company_name), properties(city, state), job_line_items(kind, quantity, unit_price_cents), invoices(status, total_cents, balance_due_cents)")
        .eq("organization_id", org).gte("created_at", start).lt("created_at", end)
        .order("job_number", { ascending: true }).range(from, to));
    return {
      headers: ["Job", "Created", "Kind", "Status", "Customer", "City", "Scheduled", "Work", "Labor ($)", "Materials ($)", "Invoiced ($)", "Paid ($)"],
      rows: found.map((row) => {
        let labor = 0;
        let materials = 0;
        for (const line of rows(row.job_line_items)) {
          const cents = Math.round(Number(line.quantity ?? 0) * Number(line.unit_price_cents ?? 0));
          if (text(line.kind) === "labor") labor += cents;
          else materials += cents;
        }
        const live = rows(row.invoices).filter((invoice) => text(invoice.status) !== "void");
        const invoiced = live.reduce((sum, invoice) => sum + Number(invoice.total_cents ?? 0), 0);
        const owed = live.reduce((sum, invoice) => sum + Number(invoice.balance_due_cents ?? 0), 0);
        const place = one(row.properties);
        return [`#${text(row.job_number)}`, day(row.created_at, timeZone), jobCategoryLabel(text(row.category)),
          text(row.status).replace(/_/g, " "), person(one(row.customers)), [text(place.city), text(place.state)].filter(Boolean).join(", "),
          when(row.scheduled_start, timeZone), text(row.customer_description).replace(/\s+/g, " ").slice(0, 500),
          dollars(labor), dollars(materials), dollars(invoiced), dollars(invoiced - owed)];
      }),
    };
  }

  if (report === "customers") {
    const found = await all((from, to) =>
      db.from("customers")
        .select("first_name, last_name, company_name, phone, email, preferred_contact, created_at, jobs(job_number, invoices(status, total_cents, balance_due_cents))")
        .eq("organization_id", org).is("archived_at", null)
        .order("created_at", { ascending: true }).range(from, to));
    return {
      headers: ["Name", "Company", "Phone", "Email", "Prefers", "Customer since", "Jobs", "Invoiced ($)", "Still owed ($)"],
      rows: found.map((row) => {
        const jobs = rows(row.jobs);
        const invoices = jobs.flatMap((job) => rows(job.invoices)).filter((invoice) => text(invoice.status) !== "void");
        return [[text(row.first_name), text(row.last_name)].filter(Boolean).join(" "), text(row.company_name), text(row.phone),
          text(row.email), text(row.preferred_contact), day(row.created_at, timeZone), jobs.length,
          dollars(invoices.reduce((sum, invoice) => sum + Number(invoice.total_cents ?? 0), 0)),
          dollars(invoices.reduce((sum, invoice) => sum + Number(invoice.balance_due_cents ?? 0), 0))];
      }),
    };
  }

  const found = await all((from, to) =>
    db.from("activity_events")
      .select("created_at, label, event_type, customers(first_name,last_name,company_name), jobs(job_number)")
      .eq("organization_id", org).gte("created_at", start).lt("created_at", end)
      .order("created_at", { ascending: true }).range(from, to));
  return {
    headers: ["When", "What", "Customer", "Job"],
    rows: found.map((row) => [when(row.created_at, timeZone), text(row.label) || text(row.event_type),
      person(one(row.customers)), one(row.jobs).job_number ? `#${text(one(row.jobs).job_number)}` : ""]),
  };
}
