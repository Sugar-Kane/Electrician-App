import "server-only";

import { addDays, calendarDate, isoToZonedWallClock, zonedWallClockToIso } from "@/lib/schedule-labels";
import { invoiceState } from "@/lib/dashboard-metrics";
import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { deliverInvoice } from "@/lib/invoice-delivery";
import { invoiceTotals } from "@/lib/invoice-math";
import { describeDelivery, formatMoney } from "@/lib/invoice-messages";
import { invoiceIsLive, invoiceIsOpenDraft, nextBillingStep } from "@/lib/job-billing";
import { advanceVisit, callOffJob, changeJob, loadChangeJob } from "@/lib/job-changes-server";
import { workflowStateOf } from "@/lib/job-workflow";
import {
  claimUnbilledLines,
  jobInvoices,
  organizationTimeZone,
  rebuildInvoiceDocument,
  retotalInvoice,
  type BilledJob,
} from "@/lib/job-billing-server";
import { readToolLines } from "@/lib/mcp-job-lines";
import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { McpSession } from "@/lib/mcp-session-token";
import { jobCategoryLabel, parseNewJob, splitName, type NewJobParsed } from "@/lib/new-job-input";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/**
 * The working day, run from ChatGPT.
 *
 * What is on today and what still needs doing, the schedule ahead, adding a
 * customer on their own, writing a new job down, moving it, taking it through the visit or calling it off,
 * putting priced parts and labor on it, and billing it. The rules are the job
 * page's: the same checks on a new job, the same refusal of a price nobody
 * gave, billing by claiming the job's unbilled lines (so nothing is billed
 * twice and the diagnostic fee comes off once), and moves, steps and
 * cancellations through job-changes-server.ts, which the job page uses too.
 *
 * Every change asks first. A tool called without `confirmed` says what it
 * would do and changes nothing; ChatGPT shows that to the electrician and
 * calls again only once they say yes.
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

const str = (description: string) => ({ type: "string", description });
const confirmed = {
  type: "boolean",
  description:
    "Set true only after the electrician explicitly approved this exact action in the current conversation. If they have not, leave false and show them the proposal returned by the tool.",
};

export const WORKDAY_MCP_TOOLS: McpTool[] = [
  {
    name: "today_plan",
    title: "Today's plan",
    description:
      "The electrician's day: every job scheduled today in time order (window, customer, address, work, status, whether parts are ready and whether it is priced), then the to-do list: finished jobs not billed yet, invoices not sent, overdue invoices, new booking requests to answer, and coming jobs with nothing priced on them. Use this for 'what's on today', a morning summary, or 'what do I need to do'.",
    inputSchema: {
      type: "object",
      properties: { date: str("Optional day as YYYY-MM-DD in the business's time zone. Defaults to today.") },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "get_schedule",
    title: "Get schedule",
    description: "The jobs booked over a stretch of days, grouped by day, in the business's time zone.",
    inputSchema: {
      type: "object",
      properties: {
        from: str("First day as YYYY-MM-DD. Defaults to today."),
        days: { type: "number", description: "How many days to show, 1 to 31. Defaults to 7." },
      },
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "create_job",
    title: "Create job",
    description:
      "Write down a new job: the customer (an existing customer with the same phone or email is reused), the address, the kind of work, what needs doing and, optionally, when. A job with a time is booked; without one it is saved as a draft to schedule later. Nothing is sent to the customer. Explicit approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        customer_name: str("Customer's full name or company."),
        phone: str("Customer's phone. A phone or an email is required."),
        email: str("Customer's email. Optional when there is a phone."),
        address_line_1: str("Street address. Give street, city, state and ZIP together, or none of them."),
        address_line_2: str("Apartment, suite or unit. Optional."),
        city: str("City."),
        state: str("Two-letter state code, such as CA."),
        postal_code: str("Five-digit ZIP."),
        access_notes: str("Gate code, parking, pets. Optional."),
        category: {
          type: "string",
          enum: ["diagnostic", "work_order"],
          description: "diagnostic: a visit to find a fault. work_order: work already agreed.",
        },
        description: str("What the customer needs done."),
        start: str("Optional start as local wall-clock time YYYY-MM-DDTHH:MM in the business's time zone."),
        duration_hours: { type: "number", description: "Optional visit length in hours. A diagnostic is always 2." },
        confirmed,
      },
      required: ["customer_name", "category", "description", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "create_customer",
    title: "Create customer",
    description:
      "Add a customer without making a job: their name or company, how to reach them, and optionally their address and notes. If a customer with the same phone or email is already on file, nothing new is made and that customer is named instead. Nothing is sent to the customer. Explicit approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        customer_name: str("Customer's full name. Optional when there is a company name."),
        company_name: str("Company or business name, for a commercial customer. Optional."),
        phone: str("Customer's phone. A phone or an email is required."),
        email: str("Customer's email. Optional when there is a phone."),
        preferred_contact: {
          type: "string",
          enum: ["sms", "phone", "email"],
          description: "How they like to be reached. Defaults to text when there is a phone, otherwise email.",
        },
        address_line_1: str("Street address. Give street, city, state and ZIP together, or none of them."),
        address_line_2: str("Apartment, suite or unit. Optional."),
        city: str("City."),
        state: str("Two-letter state code, such as CA."),
        postal_code: str("Five-digit ZIP."),
        access_notes: str("Gate code, parking, pets. Optional."),
        notes: str("Anything else worth keeping about this customer. Optional."),
        confirmed,
      },
      required: ["confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "add_job_lines",
    title: "Add priced items to a job",
    description:
      "Put priced materials and labor on a job, the lines its invoice is billed from. Use this once the materials list is agreed: every item needs the customer price each (ask the electrician; 0 means no charge), and labor is hours at the customer rate. The customer sees only the invoice total, never these lines. Explicit approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        items: {
          type: "array",
          maxItems: 60,
          items: {
            type: "object",
            properties: {
              description: str("What the part or the work is."),
              kind: { type: "string", enum: ["material", "labor"] },
              quantity: { type: "number", description: "How many, or hours for labor. Defaults to 1." },
              unit: { type: "string", enum: ["each", "ft", "box", "roll", "stick"], description: "For materials. Labor is hours." },
              unit_price: { type: "number", description: "Customer price each (or per hour) in dollars." },
            },
            required: ["description", "kind", "quantity", "unit_price"],
            additionalProperties: false,
          },
        },
        confirmed,
      },
      required: ["job_number", "items", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "bill_job",
    title: "Bill job and send the invoice",
    description:
      "Make the invoice for everything on a job not billed yet, with any diagnostic fee the customer already paid taken off, and optionally send it to the customer by text, email or both with its pay link. Call it first without confirmed to get the total, ask the electrician 'Ready to send this to the customer?', and call again with confirmed true only when they say yes. The customer sees the total only.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        send: {
          type: "string",
          enum: ["none", "sms", "email", "both"],
          description: "How to send it once made. none keeps it as a draft in Volteira.",
        },
        confirmed,
      },
      required: ["job_number", "send", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "reschedule_job",
    title: "Reschedule job",
    description:
      "Move a job to a new time. Say whether the customer should be told: if yes, they get the same rescheduled text or email the app sends. Explicit approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        start: str("New start as local wall-clock time YYYY-MM-DDTHH:MM in the business's time zone."),
        duration_hours: {
          type: "number",
          description: "Optional visit length in hours. Defaults to the job's current length, or 2 hours.",
        },
        tell_customer: { type: "boolean", description: "Send the customer the new time." },
        confirmed,
      },
      required: ["job_number", "start", "tell_customer", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "update_job_status",
    title: "Update job status",
    description:
      "Move a job through the visit: on_the_way (texts the customer that you are on the way, if that message is switched on), arrived (texts that you have arrived), working, finished (parts reserved for it come off the stock count; then bill it with bill_job), or no_show. Explicit approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        step: { type: "string", enum: ["on_the_way", "arrived", "working", "finished", "no_show"] },
        confirmed,
      },
      required: ["job_number", "step", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "cancel_job",
    title: "Cancel job",
    description:
      "Call a job off. The customer is told by text and/or email, and parts taken from stock for it go back on the count. This cannot be undone. Explicit approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        reason: str("Why, in a few words. Included in the message to the customer. Optional."),
        confirmed,
      },
      required: ["job_number", "confirmed"],
      additionalProperties: false,
    },
  },
];

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function record(value: unknown): Record<string, unknown> {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Record<string, unknown>) : {};
}

function displayCustomer(row: Record<string, unknown>): string {
  return (
    text(row.company_name) ||
    [text(row.first_name), text(row.last_name)].filter(Boolean).join(" ") ||
    "Unnamed customer"
  );
}

function requireConfirmation(args: Record<string, unknown>, proposal: string): ToolResult | null {
  if (args.confirmed === true) return null;
  return { text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: ${proposal}` };
}

function money(cents: number): string {
  return formatMoney(cents / 100);
}

function isPlainDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`));
}

function jobNumberOf(value: unknown): number | null {
  const number = Number(text(value).replace(/^#/, "").trim());
  return Number.isInteger(number) && number > 0 ? number : null;
}

const JOB_FIELDS =
  "id, job_number, status, category, customer_description, scheduled_start, scheduled_end, arrival_window_start, arrival_window_end, materials_ready_at, customers(first_name,last_name,company_name,phone), properties(address_line_1,address_line_2,city,state,postal_code,access_notes), job_line_items(id)";

/** Jobs that start between two instants, earliest first. Called-off ones are left out. */
async function jobsBetween(database: Database, organizationId: string, fromIso: string, toIso: string) {
  const { data } = await database
    .from("jobs")
    .select(JOB_FIELDS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .gte("scheduled_start", fromIso)
    .lt("scheduled_start", toIso)
    .not("status", "in", "(canceled,no_show)")
    .order("scheduled_start", { ascending: true })
    .limit(200);
  return (data ?? []) as Record<string, unknown>[];
}

function timeLabel(iso: string, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}

function dayLabel(date: string): string {
  return new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long", month: "short", day: "numeric" }).format(
    new Date(`${date}T12:00:00Z`),
  );
}

function describeJob(job: Record<string, unknown>, timeZone: string): string {
  const customer = record(job.customers);
  const place = record(job.properties);
  const start = text(job.arrival_window_start) || text(job.scheduled_start);
  const end = text(job.arrival_window_end) || text(job.scheduled_end);
  const window = start ? `${timeLabel(start, timeZone)}${end ? `–${timeLabel(end, timeZone)}` : ""}` : "no time set";
  const address = [text(place.address_line_1), text(place.address_line_2), text(place.city)].filter(Boolean).join(", ");
  const lines = Array.isArray(job.job_line_items) ? job.job_line_items.length : 0;
  return [
    `${window} | #${text(job.job_number)} ${jobCategoryLabel(text(job.category))} | ${text(job.status).replace(/_/g, " ")}`,
    `  ${displayCustomer(customer)}${text(customer.phone) ? ` (${text(customer.phone)})` : ""}${address ? ` | ${address}` : ""}`,
    text(job.customer_description) ? `  Work: ${text(job.customer_description).slice(0, 200)}` : "",
    text(place.access_notes) ? `  Access: ${text(place.access_notes).slice(0, 160)}` : "",
    `  Parts: ${text(job.materials_ready_at) ? "ready" : "not marked ready"} | Priced items: ${lines}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Midnight to midnight, where the business is. */
function dayBounds(date: string, timeZone: string): { start: string; end: string } {
  return {
    start: zonedWallClockToIso(`${date}T00:00`, timeZone),
    end: zonedWallClockToIso(`${addDays(date, 1)}T00:00`, timeZone),
  };
}

async function todayPlan(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const timeZone = await organizationTimeZone(asFlexibleClient(database), organizationId);
  const today = calendarDate(new Date().toISOString(), timeZone);
  const date = isPlainDate(text(args.date)) ? text(args.date) : today;
  const { start, end } = dayBounds(date, timeZone);

  const [jobs, unbilled, invoices, requests, coming] = await Promise.all([
    jobsBetween(database, organizationId, start, end),
    database
      .from("job_line_items")
      .select("quantity, unit_price_cents, jobs!inner(job_number, status, archived_at, customers(first_name,last_name,company_name))")
      .eq("organization_id", organizationId)
      .is("invoice_id", null)
      .eq("jobs.status", "completed")
      .is("jobs.archived_at", null)
      .limit(500),
    database
      .from("invoices")
      .select("invoice_number, status, due_at, last_sent_at, balance_due_cents, total_cents, jobs(job_number, customers(first_name,last_name,company_name))")
      .eq("organization_id", organizationId)
      .not("status", "in", "(paid,void)")
      .order("created_at", { ascending: false })
      .limit(200),
    database
      .from("booking_requests")
      .select("contact_name, phone, description, created_at, source")
      .eq("organization_id", organizationId)
      .in("status", ["new", "needs_review"])
      .order("created_at", { ascending: false })
      .limit(20),
    jobsBetween(database, organizationId, end, zonedWallClockToIso(`${addDays(date, 4)}T00:00`, timeZone)),
  ]);

  const out: string[] = [`${dayLabel(date)}${date === today ? " (today)" : ""}`, ""];
  out.push(jobs.length ? `JOBS (${jobs.length})` : "JOBS: nothing scheduled.");
  for (const job of jobs) out.push(describeJob(job, timeZone));

  const todo: string[] = [];

  // Finished work with lines nobody has billed: money not yet asked for.
  const toBill = new Map<string, { customer: string; cents: number }>();
  for (const line of (unbilled.data ?? []) as Record<string, unknown>[]) {
    const job = record(line.jobs);
    const key = text(job.job_number);
    const entry = toBill.get(key) ?? { customer: displayCustomer(record(job.customers)), cents: 0 };
    entry.cents += Math.round(Number(line.quantity ?? 0) * Number(line.unit_price_cents ?? 0));
    toBill.set(key, entry);
  }
  for (const [number, entry] of toBill) {
    todo.push(`Bill job #${number} (${entry.customer}): ${money(entry.cents)} finished and not invoiced. bill_job can make and send it.`);
  }

  for (const row of (invoices.data ?? []) as Record<string, unknown>[]) {
    const job = record(row.jobs);
    const who = displayCustomer(record(job.customers));
    const state = invoiceState({
      status: text(row.status),
      dueAt: text(row.due_at) || null,
      balanceDueCents: Number(row.balance_due_cents ?? 0),
      lastSentAt: text(row.last_sent_at) || null,
    });
    if (state === "draft") {
      todo.push(`Send INV-${text(row.invoice_number)} (${who}, job #${text(job.job_number)}): ${money(Number(row.total_cents ?? 0))} drafted, not sent.`);
    } else if (state === "overdue") {
      todo.push(`Chase INV-${text(row.invoice_number)} (${who}): ${money(Number(row.balance_due_cents ?? 0))} overdue.`);
    }
  }

  for (const request of (requests.data ?? []) as Record<string, unknown>[]) {
    todo.push(
      `Answer booking request from ${text(request.contact_name) || text(request.phone) || "a customer"}: ${text(request.description).slice(0, 140)}`,
    );
  }

  for (const job of [...jobs, ...coming]) {
    const lines = Array.isArray(job.job_line_items) ? job.job_line_items.length : 0;
    if (lines === 0 && text(job.category) !== "diagnostic") {
      todo.push(`Price job #${text(job.job_number)} (${displayCustomer(record(job.customers))}): no materials or labor on it yet.`);
    }
  }

  out.push("", todo.length ? `TO DO (${todo.length})` : "TO DO: nothing waiting.");
  todo.slice(0, 40).forEach((item, index) => out.push(`${index + 1}. ${item}`));
  return { text: out.join("\n") };
}

async function schedule(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const timeZone = await organizationTimeZone(asFlexibleClient(database), organizationId);
  const today = calendarDate(new Date().toISOString(), timeZone);
  const from = isPlainDate(text(args.from)) ? text(args.from) : today;
  const requested = Math.round(Number(args.days ?? 7));
  const days = Number.isFinite(requested) ? Math.min(31, Math.max(1, requested)) : 7;
  const jobs = await jobsBetween(
    database,
    organizationId,
    dayBounds(from, timeZone).start,
    zonedWallClockToIso(`${addDays(from, days)}T00:00`, timeZone),
  );

  const out: string[] = [`Schedule ${dayLabel(from)} to ${dayLabel(addDays(from, days - 1))} (${jobs.length} jobs)`];
  let current = "";
  for (const job of jobs) {
    const day = calendarDate(text(job.scheduled_start), timeZone);
    if (day !== current) {
      current = day;
      out.push("", dayLabel(day));
    }
    out.push(describeJob(job, timeZone));
  }
  if (jobs.length === 0) out.push("Nothing booked.");
  return { text: out.join("\n") };
}

type NewAddress = NonNullable<NewJobParsed["address"]>;
const CUSTOMER_FIELDS = "id, first_name, last_name, company_name, phone, email";

/** The oldest live customer with this email, ignoring case. */
async function customerWithEmail(database: Database, organizationId: string, email: string) {
  const { data } = await database
    .from("customers")
    .select(CUSTOMER_FIELDS)
    .eq("organization_id", organizationId)
    .ilike("email", email.replace(/[\\%_]/g, "\\$&"))
    .is("archived_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return data ? (data as Record<string, unknown>) : null;
}

/**
 * The oldest live customer with this phone, compared on the last ten digits
 * as find_or_create_customer_by_phone and the database's unique index do, so
 * "(555) 123-4567" and "+15551234567" are the same person.
 */
async function customerWithPhone(database: Database, organizationId: string, phone: string) {
  const digits = phone.replace(/\D/g, "");
  if (digits.length < 10) return null;
  const lastTen = digits.slice(-10);
  const { data } = await database
    .from("customers")
    .select(CUSTOMER_FIELDS)
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .like("phone", `%${digits.slice(-4)}`)
    .order("created_at", { ascending: true })
    .limit(50);
  const match = (Array.isArray(data) ? data : []).find(
    (row) => text((row as Record<string, unknown>).phone).replace(/\D/g, "").slice(-10) === lastTen,
  );
  return match ? (match as Record<string, unknown>) : null;
}

/** The customer's property at this street, kept if it is on file already. */
async function saveProperty(
  database: Database,
  organizationId: string,
  customerId: string,
  address: NewAddress,
  accessNotes: string,
): Promise<string | null> {
  const sameStreet = database
    .from("properties")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("customer_id", customerId)
    .eq("address_line_1", address.line1)
    .is("archived_at", null);
  const { data: existing } = await (address.line2
    ? sameStreet.eq("address_line_2", address.line2)
    : sameStreet.or("address_line_2.is.null,address_line_2.eq."))
    .limit(1)
    .maybeSingle();
  const existingId = text(existing?.id);
  if (existingId) {
    if (accessNotes) await database.from("properties").update({ access_notes: accessNotes }).eq("id", existingId);
    return existingId;
  }
  const { data: created } = await database
    .from("properties")
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      address_line_1: address.line1,
      address_line_2: address.line2 || null,
      city: address.city,
      state: address.state,
      postal_code: address.postalCode,
      access_notes: accessNotes || null,
    })
    .select("id")
    .maybeSingle();
  return text(created?.id) || null;
}

async function createCustomer(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const personName = text(args.customer_name).trim();
  const companyName = text(args.company_name).trim().slice(0, 200);
  // The new-job rules, so a customer added here passes the same checks as one
  // added with a job: a name, a phone or email that can be reached, and a
  // whole address or none.
  const parsed = parseNewJob({
    customerName: personName || companyName,
    phone: text(args.phone),
    email: text(args.email),
    addressLine1: text(args.address_line_1),
    addressLine2: text(args.address_line_2),
    city: text(args.city),
    state: text(args.state),
    postalCode: text(args.postal_code),
    accessNotes: text(args.access_notes),
    category: "diagnostic",
    description: "",
    startLocal: "",
    durationHours: "",
    cost: "",
    mode: "save",
    workOrderLines: "",
  });
  if (!parsed.ok) {
    const error = parsed.field === "customerName" ? "A customer name or company name is needed." : parsed.error;
    return { isError: true, text: `${error} Nothing was created.` };
  }
  const customer = parsed.value;
  const notes = text(args.notes).trim().slice(0, 2000);
  const asked = text(args.preferred_contact);
  const preferredContact =
    asked === "email" && customer.email ? "email" : (asked === "sms" || asked === "phone") && customer.phone ? asked : customer.phone ? "sms" : "email";

  // One person, one record: matched as a new job matches, phone first, then email.
  const byPhone = customer.phone ? await customerWithPhone(database, organizationId, customer.phone) : null;
  const existing = byPhone ?? (customer.email ? await customerWithEmail(database, organizationId, customer.email) : null);
  if (existing) {
    const how = byPhone ? "phone" : "email";
    return {
      text: `${displayCustomer(existing)} is already a customer with that ${how}, so no new customer was made. Use that customer for their jobs.`,
    };
  }

  const { firstName, lastName } = personName ? splitName(personName) : { firstName: "", lastName: "" };
  const who = [personName, companyName && companyName !== personName ? companyName : ""].filter(Boolean).join(", ");
  const reach = [customer.phone, customer.email].filter(Boolean).join(" / ");
  const where = customer.address ? ` at ${customer.address.line1}, ${customer.address.city}` : "";
  const gate = requireConfirmation(args, `Add ${who} (${reach})${where} as a new customer. Nothing is sent to them.`);
  if (gate) return gate;

  const { data, error } = await database
    .from("customers")
    .insert({
      organization_id: organizationId,
      customer_type: companyName ? "commercial" : "residential",
      first_name: firstName || null,
      last_name: lastName || null,
      company_name: companyName || null,
      phone: customer.phone || null,
      email: customer.email || null,
      preferred_contact: preferredContact,
      notes: notes || null,
    })
    .select("id")
    .maybeSingle();
  if (error?.code === "23505") {
    return { text: "A customer with that phone was added just now, so no second one was made." };
  }
  if (error || !data) return { isError: true, text: "That customer could not be saved. Nothing was created." };
  const customerId = text(data.id);

  const propertyId = customer.address
    ? await saveProperty(database, organizationId, customerId, customer.address, customer.accessNotes)
    : null;
  const addressNote = customer.address && !propertyId ? " The address could not be saved; add it from the customer's page." : "";

  return {
    text: `${who} added as a customer${propertyId ? where : ""}. Nothing was sent to them.${addressNote} To book work for them, use create_job with the same phone or email.`,
  };
}

async function createJob(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const parsed = parseNewJob({
    customerName: text(args.customer_name),
    phone: text(args.phone),
    email: text(args.email),
    addressLine1: text(args.address_line_1),
    addressLine2: text(args.address_line_2),
    city: text(args.city),
    state: text(args.state),
    postalCode: text(args.postal_code),
    accessNotes: text(args.access_notes),
    category: text(args.category),
    description: text(args.description),
    startLocal: text(args.start),
    durationHours: text(args.duration_hours),
    cost: "",
    mode: "save",
    workOrderLines: "",
  });
  if (!parsed.ok) return { isError: true, text: `${parsed.error} Nothing was created.` };
  const job = parsed.value;
  if (job.startLocal && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(job.startLocal)) {
    return { isError: true, text: "The start time must look like 2026-11-05T09:00. Nothing was created." };
  }

  const timeZone = await organizationTimeZone(asFlexibleClient(database), organizationId);
  const start = job.startLocal ? zonedWallClockToIso(job.startLocal, timeZone) : "";
  const end = start ? new Date(new Date(start).getTime() + job.durationMinutes * 60_000).toISOString() : "";

  const when = start
    ? `on ${dayLabel(calendarDate(start, timeZone))} at ${timeLabel(start, timeZone)} for ${job.durationMinutes / 60} hours`
    : "with no time yet (saved as a draft)";
  const where = job.address ? ` at ${job.address.line1}, ${job.address.city}` : "";
  const gate = requireConfirmation(
    args,
    `Create a ${jobCategoryLabel(job.category).toLowerCase()} job for ${job.customerName}${where} ${when}: "${job.description.slice(0, 160)}". Nothing is sent to the customer.`,
  );
  if (gate) return gate;

  // The same customer is the same record, matched as the job page matches:
  // by phone first, then by email, so a returning customer's history stays in one place.
  let customerId = "";
  if (job.phone) {
    const { firstName, lastName } = splitName(job.customerName);
    const { data, error } = await database.rpc("find_or_create_customer_by_phone", {
      p_organization_id: organizationId,
      p_phone: job.phone,
      p_first_name: firstName || job.customerName,
      p_last_name: lastName || null,
      p_preferred_contact: "sms",
    });
    if (error || !text(data)) return { isError: true, text: "That customer could not be saved. Nothing was created." };
    customerId = text(data);
    if (job.email) await database.from("customers").update({ email: job.email }).eq("id", customerId).is("email", null);
  }
  if (!customerId && job.email) {
    customerId = text((await customerWithEmail(database, organizationId, job.email))?.id);
  }
  if (!customerId) {
    const { firstName, lastName } = splitName(job.customerName);
    const { data, error } = await database
      .from("customers")
      .insert({
        organization_id: organizationId,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: job.phone || null,
        email: job.email || null,
        preferred_contact: job.phone ? "sms" : "email",
      })
      .select("id")
      .maybeSingle();
    if (error || !data) return { isError: true, text: "That customer could not be saved. Nothing was created." };
    customerId = text(data.id);
  }

  const propertyId = job.address
    ? await saveProperty(database, organizationId, customerId, job.address, job.accessNotes)
    : null;

  const { data: createdJob, error: jobError } = await database
    .from("jobs")
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      property_id: propertyId,
      category: job.category,
      customer_description: job.description || null,
      status: start ? "confirmed" : "draft",
      ...(start ? { scheduled_start: start, arrival_window_start: start } : {}),
      ...(end ? { scheduled_end: end, arrival_window_end: end } : {}),
    })
    .select("id, job_number")
    .maybeSingle();
  if (jobError || !createdJob) return { isError: true, text: "That job could not be saved. The customer was kept." };

  // Where the job came from, as for a job written on the job page: entered by
  // the business, so already decided rather than waiting on somebody.
  await database.from("booking_requests").insert({
    organization_id: organizationId,
    source: "owner",
    status: "scheduled",
    intent: start ? "visit" : "callback",
    phone: job.phone || "not recorded",
    contact_name: job.customerName || null,
    description: job.description || "Entered by the business.",
    customer_id: customerId,
    property_id: propertyId,
    created_job_id: createdJob.id,
    category: job.category,
    ...(start ? { arrival_window_start: start } : {}),
    ...(end ? { arrival_window_end: end } : {}),
  });

  return {
    text: `Job #${text(createdJob.job_number)} created for ${job.customerName} ${when}. Nothing was sent to the customer. Next: write its materials list (get_job_materials), then put priced items on it with add_job_lines.`,
    record: { jobId: text(createdJob.id) },
  };
}

async function findJob(database: Database, organizationId: string, value: unknown) {
  const number = jobNumberOf(value);
  if (!number) return null;
  const { data } = await database
    .from("jobs")
    .select("id, job_number, status, diagnostic_paid, diagnostic_fee_cents, follow_up_of, customers(id, first_name,last_name,company_name,phone,email)")
    .eq("organization_id", organizationId)
    .eq("job_number", number)
    .is("archived_at", null)
    .maybeSingle();
  return (data ?? null) as Record<string, unknown> | null;
}

async function addJobLines(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const reading = readToolLines(args.items);
  if (!reading.ok) return { isError: true, text: `${reading.error} Nothing was added.` };
  const job = await findJob(database, organizationId, args.job_number);
  if (!job) return { isError: true, text: `Job #${text(args.job_number)} was not found. Nothing was added.` };
  if (text(job.status) === "canceled") return { isError: true, text: `Job #${text(job.job_number)} was canceled. Nothing was added.` };

  const listed = reading.rows
    .map((row) => `${row.quantity} ${row.unit} ${row.description} at ${money(row.unit_price_cents)}`)
    .join("; ");
  const gate = requireConfirmation(
    args,
    `Add ${reading.rows.length} ${reading.rows.length === 1 ? "item" : "items"} to job #${text(job.job_number)}, ${money(reading.totalCents)} in all: ${listed}.`,
  );
  if (gate) return gate;

  const jobId = text(job.id);
  const { error } = await database
    .from("job_line_items")
    .insert(reading.rows.map((row) => ({ ...row, organization_id: organizationId, job_id: jobId })));
  if (error) return { isError: true, text: "Those items could not be added. Try again.", record: { jobId } };

  // New parts have not been gathered, as with a part added on the job page.
  await database.from("jobs").update({ materials_ready_at: null }).eq("id", jobId).not("materials_ready_at", "is", null);

  return {
    text: `Added ${reading.rows.length} ${reading.rows.length === 1 ? "item" : "items"} (${money(reading.totalCents)}) to job #${text(job.job_number)}. When the work is ready to bill, use bill_job.`,
    record: { jobId },
  };
}

async function billJob(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const send = ["sms", "email", "both"].includes(text(args.send)) ? text(args.send) : "none";
  const job = await findJob(database, organizationId, args.job_number);
  if (!job) return { isError: true, text: `Job #${text(args.job_number)} was not found. Nothing was billed.` };
  const jobId = text(job.id);
  const jobNumber = text(job.job_number);
  const customer = record(job.customers);
  const flexible = asFlexibleClient(database);

  const billed: BilledJob = {
    id: jobId,
    followUpOf: text(job.follow_up_of) || null,
    diagnosticPaid: Boolean(job.diagnostic_paid),
    diagnosticFeeCents: Number(job.diagnostic_fee_cents ?? 0),
  };
  const invoices = await jobInvoices(flexible, organizationId, jobId);
  const { data: lineRows } = await database
    .from("job_line_items")
    .select("quantity, unit_price_cents, invoice_id")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId);
  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((line) => ({
    quantity: Number(line.quantity ?? 0),
    unitPriceCents: Number(line.unit_price_cents ?? 0),
    invoiceId: text(line.invoice_id) || null,
  }));
  const step = nextBillingStep(lines, invoices);
  const voidInvoiceIds = invoices.filter((invoice) => !invoiceIsLive(invoice)).map((invoice) => invoice.id);
  const draft = step.kind === "add_to_draft" ? invoices.find((invoice) => invoice.id === step.invoice.id) : undefined;

  // Nothing new to bill, but a draft nobody has seen yet: that draft is the bill to send.
  const unsentDraft = step.kind === "nothing" ? invoices.find((invoice) => invoiceIsOpenDraft(invoice)) : undefined;
  if (step.kind === "nothing" && !unsentDraft) {
    return {
      isError: true,
      text: lines.length === 0
        ? `Job #${jobNumber} has no priced items yet, so there is nothing to bill. Add them with add_job_lines.`
        : `Everything on job #${jobNumber} is already on a sent invoice. Nothing was billed.`,
    };
  }

  // What the bill comes to, worked out before anything is written, so the
  // electrician says yes to the real figure.
  const credit = await diagnosticCreditLeft(flexible, organizationId, billed);
  let proposedTotal: number;
  let proposedCredit = 0;
  let what: string;
  if (step.kind === "add_to_draft" && draft) {
    const totals = invoiceTotals({ subtotalCents: draft.subtotalCents + step.cents, taxCents: draft.taxCents, diagnosticPaidCents: credit });
    proposedTotal = totals.totalCents;
    proposedCredit = totals.diagnosticCreditCents;
    what = `Add ${money(step.cents)} to draft INV-${draft.number}, which then comes to ${money(proposedTotal)}`;
  } else if (step.kind === "first" || step.kind === "bill_difference") {
    const totals = invoiceTotals({ subtotalCents: step.cents, diagnosticPaidCents: credit });
    proposedTotal = totals.totalCents;
    proposedCredit = totals.diagnosticCreditCents;
    what = `Invoice job #${jobNumber} for ${money(proposedTotal)}`;
  } else {
    proposedTotal = unsentDraft!.totalCents;
    what = `INV-${unsentDraft!.number} for ${money(proposedTotal)} is already drafted on job #${jobNumber}`;
  }
  const creditNote = proposedCredit > 0 ? ` (the ${money(proposedCredit)} diagnostic fee already paid is taken off)` : "";
  const reach = send === "sms" ? text(customer.phone) : send === "email" ? text(customer.email) : [text(customer.phone), text(customer.email)].filter(Boolean).join(" and ");
  const sendNote = send === "none" ? " Keep it as a draft; nothing is sent." : ` Send it to ${displayCustomer(customer)} by ${send === "both" ? "text and email" : send === "sms" ? "text" : "email"}${reach ? ` (${reach})` : ""} with the pay link. The customer sees the total only.`;
  if (step.kind === "nothing" && send === "none") {
    return { text: `${what}. Nothing new to bill. Call bill_job with send sms, email or both to send it.` };
  }
  const gate = requireConfirmation(args, `${what}${creditNote}.${sendNote}`);
  if (gate) return gate;

  const { data: organization } = await database
    .from("organizations")
    .select("name, phone, created_by")
    .eq("id", organizationId)
    .maybeSingle();
  const uploadedBy = text(organization?.created_by);

  let invoiceId = "";
  let invoiceNumber = "";
  let totalCents = proposedTotal;

  if (step.kind === "add_to_draft" && draft) {
    const claimed = await claimUnbilledLines(flexible, { organizationId, jobId, invoiceId: draft.id, voidInvoiceIds });
    if (!claimed) return { isError: true, text: `The items could not be added to INV-${draft.number}. Nothing was sent.` };
    const recounted = await retotalInvoice(flexible, {
      organizationId,
      invoice: draft,
      job: billed,
      subtotalCents: draft.subtotalCents + claimed.cents,
    });
    if (!recounted) {
      return { isError: true, text: `The items are on INV-${draft.number}, but its total could not be updated. Open it in Volteira before sending. Nothing was sent.` };
    }
    invoiceId = draft.id;
    invoiceNumber = String(draft.number);
    totalCents = recounted.totalCents;
  } else if (step.kind === "first" || step.kind === "bill_difference") {
    const totals = invoiceTotals({ subtotalCents: step.cents, diagnosticPaidCents: credit });
    const { data: created, error } = await database
      .from("invoices")
      .insert({
        organization_id: organizationId,
        job_id: jobId,
        status: "draft",
        subtotal_cents: totals.subtotalCents,
        diagnostic_credit_cents: totals.diagnosticCreditCents,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents,
        balance_due_cents: totals.totalCents,
        stripe_application_fee_cents: totals.applicationFeeCents,
      })
      .select("id, invoice_number")
      .maybeSingle();
    if (error || !created) return { isError: true, text: "The invoice could not be saved. Nothing was sent." };
    invoiceId = text(created.id);
    invoiceNumber = text(created.invoice_number);

    const claimed = await claimUnbilledLines(flexible, { organizationId, jobId, invoiceId, voidInvoiceIds });
    if (claimed && claimed.cents !== step.cents) {
      // Billed from somewhere else in between: the invoice bills what it actually holds.
      if (claimed.cents <= 0) {
        await database.from("invoices").delete().eq("id", invoiceId).eq("organization_id", organizationId);
        return { isError: true, text: "Those items were billed a moment ago from somewhere else. Nothing was sent." };
      }
      const recounted = await retotalInvoice(flexible, {
        organizationId,
        invoice: { id: invoiceId, taxCents: totals.taxCents, diagnosticCreditCents: totals.diagnosticCreditCents },
        job: billed,
        subtotalCents: claimed.cents,
      });
      if (recounted) totalCents = recounted.totalCents;
    }
  } else {
    invoiceId = unsentDraft!.id;
    invoiceNumber = String(unsentDraft!.number);
  }

  // The PDF is made now, so what the customer is sent and what is on screen are one file.
  const documentReady = step.kind === "nothing" || (uploadedBy
    ? await rebuildInvoiceDocument(flexible, { organizationId, invoiceId, uploadedBy })
    : false);
  const made = `INV-${invoiceNumber} for ${money(totalCents)} is ready on job #${jobNumber}.`;

  if (send === "none") {
    return {
      text: `${made}${documentReady ? "" : " The PDF could not be made; open the invoice in Volteira to try again."} It has not been sent.`,
      record: { jobId },
    };
  }

  const { data: invoiceRow } = await database
    .from("invoices")
    .select("stripe_hosted_invoice_url")
    .eq("id", invoiceId)
    .maybeSingle();
  const attempts = await deliverInvoice({
    invoiceId,
    organizationId,
    channels: send === "both" ? ["sms", "email"] : [send],
    customerPhone: text(customer.phone),
    customerEmail: text(customer.email),
    customerId: text(customer.id) || undefined,
    facts: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      contactName: displayCustomer(customer),
      invoiceNumber: `INV-${invoiceNumber}`,
      amountDue: totalCents / 100,
      dueLabel: "",
      payUrl: text(invoiceRow?.stripe_hosted_invoice_url) || undefined,
    },
  });
  const delivery = describeDelivery(attempts);
  return {
    text: `${made} ${delivery.message}`,
    isError: attempts.every((attempt) => !attempt.ok),
    record: { jobId },
  };
}

const STEP_STATES = {
  on_the_way: "en_route",
  arrived: "arrived",
  working: "working",
  finished: "completed",
  no_show: "no_show",
} as const;

const STEP_SAYS = {
  on_the_way: "on the way (the customer is texted that you are on the way, if that message is switched on)",
  arrived: "arrived (the customer is texted that you have arrived, if that message is switched on)",
  working: "working",
  finished: "finished (parts reserved for it come off the stock count)",
  no_show: "no show",
} as const;

async function rescheduleJob(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const job = await loadChangeJob(asFlexibleClient(database), organizationId, String(jobNumberOf(args.job_number) ?? ""));
  if (!job) return { isError: true, text: `Job #${text(args.job_number)} was not found. Nothing was changed.` };
  if (job.status === "canceled") return { isError: true, text: "That job is canceled. Create a new job instead." };

  const startLocal = text(args.start).trim();
  const start = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(startLocal) ? zonedWallClockToIso(startLocal, job.timeZone) : "";
  if (!start) return { isError: true, text: "The new start must look like 2026-11-05T09:00. Nothing was changed." };

  const typedHours = Number(args.duration_hours);
  const currentMinutes = job.start && job.end ? (Date.parse(job.end) - Date.parse(job.start)) / 60_000 : 0;
  const minutes = Number.isFinite(typedHours) && typedHours > 0
    ? Math.round(typedHours * 60)
    : currentMinutes > 0 ? currentMinutes : 120;
  if (minutes > 12 * 60) return { isError: true, text: "A single visit cannot be longer than 12 hours. Nothing was changed." };
  const end = new Date(Date.parse(start) + minutes * 60_000).toISOString();

  const tell = args.tell_customer === true;
  const gate = requireConfirmation(
    args,
    `Move job #${text(args.job_number)} (${job.contactName || "customer"}) to ${dayLabel(calendarDate(start, job.timeZone))}, ${timeLabel(start, job.timeZone)}–${timeLabel(end, job.timeZone)}. ${tell ? "The customer is sent the new time." : "The customer is not told."}`,
  );
  if (gate) return gate;

  const result = await changeJob(job, {
    startLocal: isoToZonedWallClock(start, job.timeZone),
    endLocal: isoToZonedWallClock(end, job.timeZone),
    status: "",
    notifyCustomer: tell,
  });
  return result.error
    ? { isError: true, text: `${result.error} Nothing was changed.`, record: { jobId: job.id } }
    : { text: result.notice ?? "Job moved.", record: { jobId: job.id } };
}

async function updateJobStatus(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const step = text(args.step) as keyof typeof STEP_STATES;
  if (!(step in STEP_STATES)) return { isError: true, text: "That is not a step a job can take." };
  const job = await loadChangeJob(asFlexibleClient(database), organizationId, String(jobNumberOf(args.job_number) ?? ""));
  if (!job) return { isError: true, text: `Job #${text(args.job_number)} was not found. Nothing was changed.` };

  const gate = requireConfirmation(args, `Mark job #${text(args.job_number)} (${job.contactName || "customer"}) ${STEP_SAYS[step]}.`);
  if (gate) return gate;

  const visit = { supabase: job.supabase, organizationId, id: job.id, status: job.status, technicianId: job.technicianId };
  const requested = STEP_STATES[step];

  // Finishing from the middle of the work goes through review, as the job
  // page's buttons do: working, then review, then completed.
  if (requested === "completed" && workflowStateOf(job.status) === "working") {
    const review = await advanceVisit(visit, { requested: "review", source: "manual" });
    if (review.error) return { isError: true, text: review.error, record: { jobId: job.id } };
    visit.status = "needs_review";
  }

  const result = await advanceVisit(visit, { requested, source: "manual" });
  if (result.error) return { isError: true, text: `${result.error} Nothing was changed.`, record: { jobId: job.id } };

  const label = step.replace(/_/g, " ");
  const next = result.finished ? " Bill it with bill_job when you are ready." : "";
  return { text: `Job #${text(args.job_number)} is now ${label}.${result.notice ? ` ${result.notice}` : ""}${next}`, record: { jobId: job.id } };
}

async function cancelJob(database: Database, organizationId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const job = await loadChangeJob(asFlexibleClient(database), organizationId, String(jobNumberOf(args.job_number) ?? ""));
  if (!job) return { isError: true, text: `Job #${text(args.job_number)} was not found. Nothing was changed.` };
  if (job.status === "canceled") return { isError: true, text: "That job is already canceled." };

  const reason = text(args.reason).trim().slice(0, 500);
  const when = job.start ? ` on ${dayLabel(calendarDate(job.start, job.timeZone))} at ${timeLabel(job.start, job.timeZone)}` : "";
  const gate = requireConfirmation(
    args,
    `Cancel job #${text(args.job_number)} (${job.contactName || "customer"})${when}${reason ? `, reason: "${reason}"` : ""}. The customer is told it is canceled. This cannot be undone.`,
  );
  if (gate) return gate;

  const result = await callOffJob(job, reason);
  return result.error
    ? { isError: true, text: result.error, record: { jobId: job.id } }
    : { text: result.notice ?? "Job canceled.", record: { jobId: job.id } };
}

export async function runWorkdayMcpTool(input: {
  database: Database;
  session: McpSession;
  name: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const { database, session, name, args } = input;
  if (session.scope !== "business") {
    return { isError: true, text: "This MCP token is booking-only. No business action was run." };
  }
  const organizationId = session.organizationId;
  switch (name) {
    case "today_plan":
      return todayPlan(database, organizationId, args);
    case "get_schedule":
      return schedule(database, organizationId, args);
    case "create_customer":
      return createCustomer(database, organizationId, args);
    case "create_job":
      return createJob(database, organizationId, args);
    case "add_job_lines":
      return addJobLines(database, organizationId, args);
    case "bill_job":
      return billJob(database, organizationId, args);
    case "reschedule_job":
      return rescheduleJob(database, organizationId, args);
    case "update_job_status":
      return updateJobStatus(database, organizationId, args);
    case "cancel_job":
      return cancelJob(database, organizationId, args);
    default:
      return { isError: true, text: `Unknown workday tool: ${name}` };
  }
}
