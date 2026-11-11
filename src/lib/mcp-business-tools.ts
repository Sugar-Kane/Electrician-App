import "server-only";

import { buildBusinessHours, parseBusinessHours } from "@/lib/business-hours";
import { completeDraftFields, fillTemplate, placeholdersUsed, scopePrompt, serviceAddress, STARTER_TEMPLATE, type ContractFacts } from "@/lib/contract-template";
import { deliverInvoice } from "@/lib/invoice-delivery";
import { invoiceTotals } from "@/lib/invoice-math";
import { describeDelivery, formatMoney } from "@/lib/invoice-messages";
import { claimUnbilledLines, jobInvoices } from "@/lib/job-billing-server";
import {
  carryPrices,
  estimateItems,
  hasContent,
  listItems,
  materialJobFacts,
  materialListInstructions,
  materialListMarkdown,
  readPastedMaterialList,
  type ChatTurn,
} from "@/lib/material-list";
import { readMaterialList, writeMaterialList, type SavedMaterialList } from "@/lib/material-list-server";
import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { McpSession } from "@/lib/mcp-session-token";
import { parseCostToCents } from "@/lib/new-job-input";
import { cartAgentSteps, cartSlug, cartStore, storeCart } from "@/lib/store-cart";
import { getSupplierIntegrations } from "@/lib/supplier-integrations";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { sendSms } from "@/lib/twilio";
import { sendCustomerText, textingAllowed } from "@/lib/customer-text";
import { recordActivity } from "@/lib/activity";
import { contractSendRefusal } from "@/lib/contract-send";
import { signingLinkMessage } from "@/lib/contract-signing";
import { formatForDisplay, toE164 } from "@/lib/phone-format";
import { billingParty } from "@/lib/customer-details";

const str = (description: string) => ({ type: "string", description });
const confirmed = {
  type: "boolean",
  description:
    "Set true only after the business owner explicitly approved this exact action in the current conversation. If they have not, leave false and show them the proposal returned by the tool.",
};

export const BUSINESS_MCP_TOOLS: McpTool[] = [
  {
    name: "search_customers",
    title: "Search customers",
    description: "Find customers in this business by name, phone or email.",
    inputSchema: {
      type: "object",
      properties: { query: str("Name, phone number or email.") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "search_jobs",
    title: "Search jobs",
    description: "Find recent jobs by job number, customer, city, work description or status.",
    inputSchema: {
      type: "object",
      properties: { query: str("Search text. Empty string returns recent jobs.") },
      required: ["query"],
      additionalProperties: false,
    },
  },
  {
    name: "weekly_business_update",
    title: "Weekly business update",
    description:
      "Summarize the last seven days of jobs and invoices, including completed work, open work, unassigned active jobs, invoiced revenue and outstanding balances.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_business_hours",
    title: "Get business hours",
    description: "Read the business hours used by public booking and scheduling.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "set_business_hours",
    title: "Set business hours",
    description:
      "Change one weekday's business hours. This changes customer-visible scheduling, so explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        day: {
          type: "string",
          enum: ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"],
        },
        enabled: { type: "boolean", description: "Whether the business is open that day." },
        start: str("24-hour local time HH:MM. Required when enabled."),
        end: str("24-hour local time HH:MM. Required when enabled."),
        confirmed,
      },
      required: ["day", "enabled", "start", "end", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "draft_estimate",
    title: "Draft a pricing estimate",
    description:
      "Get what you need to draft labor and material lines for a job. You write the draft yourself from what this returns; nothing is saved or sent. Once the electrician agrees the items and prices, put them on the job with add_job_lines.",
    inputSchema: {
      type: "object",
      properties: { description: str("What work the customer needs, with as much known detail as practical.") },
      required: ["description"],
      additionalProperties: false,
    },
  },
  {
    name: "list_invoices",
    title: "List invoices",
    description: "List recent invoices and payment status.",
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["all", "draft", "sent", "paid", "overdue", "void"] },
      },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "create_invoice",
    title: "Create invoice",
    description:
      "Create a draft invoice on an existing job. Duplicate same-job/same-total drafts are refused. Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The existing job number."),
        amount: str("Invoice amount in dollars, such as 1280.50."),
        confirmed,
      },
      required: ["job_number", "amount", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "send_invoice",
    title: "Send invoice and payment link",
    description:
      "Send an existing unpaid invoice to its customer by SMS, email or both, asking them to pay. The existing Stripe hosted payment URL is included when available. Not for paid invoices (use send_paid_invoice) or customers who already paid in hand (use mark_invoice_paid). Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_number: str("Invoice number, with or without INV- prefix."),
        channel: { type: "string", enum: ["sms", "email", "both"] },
        confirmed,
      },
      required: ["invoice_number", "channel", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "send_text",
    title: "Text a customer",
    description:
      "Send an operational SMS to an existing customer with active SMS consent. Explicit owner approval of the exact recipient and text is required.",
    inputSchema: {
      type: "object",
      properties: {
        customer: str("Customer name or phone number."),
        message: str("Exact message to send, maximum 500 characters."),
        confirmed,
      },
      required: ["customer", "message", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "draft_contract",
    title: "Create draft contract",
    description:
      "Create a stored draft contract for an existing job from the business template and render its PDF when possible. You write the scope-of-work paragraph yourself: call once without scope to get the job's details and the rules for it, then again with scope. Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The existing job number."),
        scope: str("The scope-of-work paragraph you wrote, following the rules the first call returns. Leave empty to get them."),
        confirmed,
      },
      required: ["job_number", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "complete_contract_details",
    title: "Fill in a contract's missing details",
    description:
      "Fill in the details a job's draft contract is still missing (for example service_address or scope), the way the job page's \"Save contract details\" does: it saves a new completed draft and rebuilds the PDF; the old draft is left as it was. Call once with only job_number to see which fields are missing and, for scope, the rules for writing it; then call again with values and confirmed true. Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The existing job number."),
        values: {
          type: "object",
          description: "Each missing field by its name, e.g. {\"service_address\": \"335 Kestrel Way, Nipomo, CA 93444\", \"scope\": \"...\"}. Plain text, up to 5,000 characters each.",
          additionalProperties: { type: "string" },
        },
        confirmed,
      },
      required: ["job_number"],
      additionalProperties: false,
    },
  },
  {
    name: "send_contract_for_signature",
    title: "Text a contract for signature",
    description:
      "Text the customer a link to sign a job's contract on their phone: the job's newest contract that is not cancelled, once it is fully filled in. The business signs it first with the saved signature of the owner who connected ChatGPT, then the customer gets the link at the phone number on their customer record. Only for a customer with active SMS consent. Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The existing job number."),
        confirmed,
      },
      required: ["job_number", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "supplier_integration_status",
    title: "Supplier integration status",
    description:
      "Show whether Lowe's and Home Depot supplier integrations have the credentials needed for live product/order capabilities.",
    inputSchema: { type: "object", properties: {}, required: [], additionalProperties: false },
  },
  {
    name: "get_job_materials",
    title: "Get a job's materials list",
    description:
      "Read what a job is (the kind of work, what the customer asked for, the electrician's notes, the town), the exact format a materials list must be written in, and the job's saved materials list if it has one. Call this before writing or changing a job's materials list.",
    inputSchema: {
      type: "object",
      properties: { job_number: str("The existing job number.") },
      required: ["job_number"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: "save_materials_list",
    title: "Save a materials list to a job",
    description:
      "Save a materials list onto an existing job, replacing the job's saved list. Write the whole list in the format get_job_materials gives, with every item, including ones kept from the saved list, and pass the list_version get_job_materials gave. If the list was changed in Volteira since, nothing is saved. Nothing is ordered or sent to the customer: the electrician reviews, prices and adds the items to the estimate in Volteira. Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The existing job number."),
        list: str("The whole materials list, in the format get_job_materials gives."),
        list_version: str("The list_version from get_job_materials, or from the last save_materials_list on this job."),
        request: str("In a few words, what the electrician asked for, e.g. 'EV charger in the garage, 40 ft run'."),
        confirmed,
      },
      required: ["job_number", "list", "list_version", "confirmed"],
      additionalProperties: false,
    },
    // It replaces the job's saved list.
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
  },
  {
    name: "store_cart",
    title: "Get a job's Home Depot or Lowe's cart",
    description:
      "When the electrician wants a job's materials put in their Home Depot or Lowe's cart: read the job's saved, priced materials list as that store's products (link, item number, how many), with the steps for filling the cart and the Volteira page that holds them. Items the store has no match for, and items with no quantity, come back marked for you to recommend a product and a quantity. Neither store has an ordering connection, so the cart is filled in a web browser signed in to the electrician's own store account: your own browser if you have one (Muse, ChatGPT agent mode or similar). Nothing is bought.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The existing job number."),
        store: { type: "string", enum: ["home-depot", "lowes"], description: "Which store's cart to fill." },
      },
      required: ["job_number", "store"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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
  return {
    text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: ${proposal}`,
  };
}

async function findCustomer(
  database: ReturnType<typeof getSupabaseAdmin>,
  organizationId: string,
  query: string,
): Promise<{ row?: Record<string, unknown>; problem?: string }> {
  const needle = query.toLowerCase();
  const { data } = await database
    .from("customers")
    .select("id, first_name, last_name, company_name, phone, email")
    .eq("organization_id", organizationId)
    .is("archived_at", null)
    .limit(250);

  const matches = ((data ?? []) as Record<string, unknown>[]).filter((row) =>
    `${displayCustomer(row)} ${text(row.phone)} ${text(row.email)}`.toLowerCase().includes(needle),
  );
  if (matches.length === 0) return { problem: `No customer matches “${query}”.` };
  if (matches.length > 1) {
    return {
      problem: `More than one customer matches “${query}”: ${matches
        .slice(0, 8)
        .map((row) => `${displayCustomer(row)} (${text(row.phone) || "no phone"})`)
        .join(", ")}. Use a more specific name or phone number.`,
    };
  }
  return { row: matches[0] };
}

/** The list_version of a job with no saved list yet. */
const NO_LIST_VERSION = "none";

/** A job of this business by its number, with its saved materials list. */
async function materialsJob(
  database: ReturnType<typeof getSupabaseAdmin>,
  organizationId: string,
  rawNumber: unknown,
): Promise<{ job: Record<string, unknown>; saved: SavedMaterialList } | null> {
  // Asked for as text, but a client may send it as a number.
  const number = Number((typeof rawNumber === "number" ? String(rawNumber) : text(rawNumber)).replace(/^#/, ""));
  if (!Number.isInteger(number) || number <= 0) return null;
  const { data } = await database
    .from("jobs")
    .select("id, job_number, category, customer_description, technician_notes, properties ( city, state ), customers ( customer_type )")
    .eq("organization_id", organizationId)
    .eq("job_number", number)
    .maybeSingle();
  const job = (data ?? null) as Record<string, unknown> | null;
  if (!job || !text(job.id)) return null;
  return { job, saved: await readMaterialList(asFlexibleClient(database), text(job.id)) };
}

export async function runBusinessMcpTool(input: {
  database: ReturnType<typeof getSupabaseAdmin>;
  session: McpSession;
  name: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const { database, session, name, args } = input;
  const organizationId = session.organizationId;

  if (session.scope !== "business") {
    return { isError: true, text: "This MCP token is booking-only. No business action was run." };
  }

  switch (name) {
    case "search_customers": {
      const query = text(args.query).toLowerCase();
      if (!query) return { text: "Give a name, phone number or email to search for." };
      const { data } = await database
        .from("customers")
        .select("id, first_name, last_name, company_name, phone, email, preferred_contact")
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .limit(250);
      const rows = ((data ?? []) as Record<string, unknown>[]).filter((row) =>
        `${displayCustomer(row)} ${text(row.phone)} ${text(row.email)}`.toLowerCase().includes(query),
      );
      if (rows.length === 0) return { text: "No customers match that." };
      return {
        text: rows
          .slice(0, 15)
          .map((row) => `${displayCustomer(row)} | ${text(row.phone) || "no phone"} | ${text(row.email) || "no email"}`)
          .join("\n"),
      };
    }

    case "search_jobs": {
      const query = text(args.query).toLowerCase();
      const { data } = await database
        .from("jobs")
        .select(
          "job_number, status, category, priority, customer_description, scheduled_start, scheduled_end, technician_id, customers(first_name,last_name,company_name), properties(address_line_1,city,state)",
        )
        .eq("organization_id", organizationId)
        .is("archived_at", null)
        .order("created_at", { ascending: false })
        .limit(150);
      const rows = ((data ?? []) as Record<string, unknown>[]).filter((row) => {
        if (!query) return true;
        const customer = record(row.customers);
        const property = record(row.properties);
        return `${row.job_number ?? ""} ${row.status ?? ""} ${row.category ?? ""} ${row.customer_description ?? ""} ${displayCustomer(customer)} ${property.city ?? ""}`
          .toLowerCase()
          .includes(query);
      });
      if (rows.length === 0) return { text: "No jobs match that." };
      return {
        text: rows
          .slice(0, 15)
          .map((row) => {
            const customer = record(row.customers);
            const property = record(row.properties);
            return `#${row.job_number} | ${text(row.status)} | ${displayCustomer(customer)} | ${text(property.city)} | ${text(row.customer_description).slice(0, 120)} | ${text(row.scheduled_start) || "unscheduled"}`;
          })
          .join("\n"),
      };
    }

    case "weekly_business_update": {
      const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const [{ data: jobs }, { data: invoices }] = await Promise.all([
        database
          .from("jobs")
          .select("job_number,status,technician_id,created_at,scheduled_start")
          .eq("organization_id", organizationId)
          .is("archived_at", null)
          .gte("created_at", since),
        database
          .from("invoices")
          .select("status,total_cents,balance_due_cents,created_at,paid_at")
          .eq("organization_id", organizationId)
          .gte("created_at", since),
      ]);
      const jobRows = (jobs ?? []) as Record<string, unknown>[];
      const invoiceRows = (invoices ?? []) as Record<string, unknown>[];
      const completed = jobRows.filter((row) => text(row.status) === "completed").length;
      const active = jobRows.filter((row) => !["completed", "canceled", "cancelled"].includes(text(row.status)));
      // Completed jobs deliberately never count as "needs assignment".
      const unassigned = active.filter((row) => !text(row.technician_id)).length;
      const invoiced = invoiceRows.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
      const outstanding = invoiceRows.reduce((sum, row) => sum + Number(row.balance_due_cents ?? 0), 0);
      const paid = invoiceRows.filter((row) => Boolean(row.paid_at) || text(row.status) === "paid").length;
      return {
        text: [
          "Last 7 days:",
          `${jobRows.length} jobs created; ${completed} completed; ${active.length} still active; ${unassigned} active jobs unassigned.`,
          `${invoiceRows.length} invoices created totaling ${formatMoney(invoiced / 100)}; ${paid} paid; ${formatMoney(outstanding / 100)} remains outstanding on those invoices.`,
        ].join("\n"),
      };
    }

    case "get_business_hours": {
      const { data } = await database
        .from("service_settings")
        .select("business_hours")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const hours = parseBusinessHours(data?.business_hours);
      if (hours.length === 0) return { text: "No valid open business hours are configured." };
      const labels = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
      return {
        text: hours.map((day) => `${labels[day.weekday]} ${day.start}–${day.end}`).join("\n"),
      };
    }

    case "set_business_hours": {
      const day = text(args.day).toLowerCase();
      const enabled = args.enabled === true;
      const start = text(args.start);
      const end = text(args.end);
      const proposal = enabled ? `Open ${day} from ${start} to ${end}.` : `Close the business on ${day}.`;
      const gate = requireConfirmation(args, proposal);
      if (gate) return gate;

      const labels = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
      const weekday = labels.indexOf(day);
      if (weekday < 0) return { isError: true, text: "That weekday is not valid." };
      if (enabled && (!/^\d{2}:\d{2}$/.test(start) || !/^\d{2}:\d{2}$/.test(end) || end <= start)) {
        return { isError: true, text: "Hours must be valid 24-hour HH:MM values, with end later than start." };
      }

      const { data: settings } = await database
        .from("service_settings")
        .select("business_hours")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const current = parseBusinessHours(settings?.business_hours);
      const next = current.filter((entry) => entry.weekday !== weekday);
      if (enabled) next.push({ weekday, start, end });
      const businessHours = buildBusinessHours(next, settings?.business_hours);
      const { error } = await database
        .from("service_settings")
        .update({ business_hours: businessHours })
        .eq("organization_id", organizationId);
      return error
        ? { isError: true, text: "Business hours could not be changed." }
        : { text: `Business hours updated. ${proposal}` };
    }

    case "draft_estimate": {
      const description = text(args.description);
      if (description.length < 10) return { text: "Give a little more detail about the work before drafting an estimate." };
      // Drafted by the assistant the electrician is talking to, on their own
      // plan, rather than by Volteira's built-in AI.
      return {
        text: [
          "Write the draft estimate yourself from this description. Nothing has been saved.",
          "",
          `WORK: ${description.slice(0, 2000)}`,
          "",
          "HOW TO WRITE IT",
          "- Labor: hours for each part of the work, at the electrician's hourly rate (ask for it if you don't know it).",
          "- Materials: each part with a quantity, a unit (each, ft, box, roll or stick) and a suggested customer price each.",
          "- Say plainly that the prices are suggestions to check, and never invent work that was not described.",
          "- Show it as a short list and ask the electrician to correct anything. When they agree, put it on the job with add_job_lines.",
        ].join("\n"),
      };
    }

    case "list_invoices": {
      const requested = text(args.status) || "all";
      let query = database
        .from("invoices")
        .select("invoice_number,status,total_cents,balance_due_cents,due_at,last_sent_at,jobs(customers(first_name,last_name,company_name))")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(30);
      if (requested !== "all") query = query.eq("status", requested);
      const { data } = await query;
      const rows = (data ?? []) as Record<string, unknown>[];
      if (rows.length === 0) return { text: `No ${requested === "all" ? "" : `${requested} `}invoices found.` };
      return {
        text: rows.map((row) => {
          const job = record(row.jobs);
          const customer = record(job.customers);
          return `INV-${row.invoice_number} | ${displayCustomer(customer)} | ${formatMoney(Number(row.total_cents ?? 0) / 100)} | ${text(row.status)} | balance ${formatMoney(Number(row.balance_due_cents ?? 0) / 100)}`;
        }).join("\n"),
      };
    }

    case "create_invoice": {
      const jobNumber = Number(text(args.job_number));
      const cents = parseCostToCents(text(args.amount));
      const proposal = `Create a draft invoice on job #${text(args.job_number)} for ${text(args.amount)}.`;
      const gate = requireConfirmation(args, proposal);
      if (gate) return gate;
      if (!Number.isFinite(jobNumber) || cents === null || cents <= 0) {
        return { isError: true, text: "The job number or amount could not be read. Nothing was created." };
      }
      const { data: job } = await database
        .from("jobs")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber)
        .maybeSingle();
      if (!job) return { isError: true, text: `Job #${jobNumber} was not found. Nothing was created.` };

      const totals = invoiceTotals({ subtotalCents: cents });
      const { data: duplicate } = await database
        .from("invoices")
        .select("invoice_number")
        .eq("organization_id", organizationId)
        .eq("job_id", text(job.id))
        .eq("status", "draft")
        .eq("total_cents", totals.totalCents)
        .limit(1)
        .maybeSingle();
      if (duplicate) {
        return { isError: true, text: `Duplicate refused. INV-${duplicate.invoice_number} is already a draft on job #${jobNumber} for that amount.` };
      }

      const { data: created, error } = await database
        .from("invoices")
        .insert({
          organization_id: organizationId,
          job_id: text(job.id),
          status: "draft",
          subtotal_cents: totals.subtotalCents,
          diagnostic_credit_cents: totals.diagnosticCreditCents,
          tax_cents: totals.taxCents,
          total_cents: totals.totalCents,
          balance_due_cents: totals.totalCents,
          stripe_application_fee_cents: totals.applicationFeeCents,
        })
        .select("id,invoice_number,total_cents")
        .maybeSingle();
      if (error || !created) return { isError: true, text: "The invoice could not be created." };

      // The amount is the price of whatever is on the job unbilled, so those
      // lines are this invoice's. Left unbilled, the job page would offer to
      // bill them a second time.
      const voided = (await jobInvoices(asFlexibleClient(database), organizationId, text(job.id)))
        .filter((invoice) => invoice.status === "void")
        .map((invoice) => invoice.id);
      await claimUnbilledLines(asFlexibleClient(database), {
        organizationId,
        jobId: text(job.id),
        invoiceId: text(created.id),
        voidInvoiceIds: voided,
      });

      return { text: `Draft INV-${created.invoice_number} created for ${formatMoney(Number(created.total_cents) / 100)}. It has not been sent.` };
    }

    case "send_invoice": {
      const rawNumber = text(args.invoice_number).replace(/^INV-/i, "");
      const number = Number(rawNumber);
      const channel = text(args.channel);
      const proposal = `Send INV-${rawNumber} by ${channel}.`;
      const gate = requireConfirmation(args, proposal);
      if (gate) return gate;
      if (!Number.isFinite(number)) return { isError: true, text: "That invoice number could not be read." };
      const { data } = await database
        .from("invoices")
        .select(
          "id,invoice_number,status,total_cents,due_at,stripe_hosted_invoice_url,jobs(customer_description,customers(first_name,last_name,company_name,phone,email)),organizations(name,phone,timezone)",
        )
        .eq("organization_id", organizationId)
        .eq("invoice_number", number)
        .maybeSingle();
      if (!data) return { isError: true, text: `INV-${rawNumber} was not found. Nothing was sent.` };
      const row = data as Record<string, unknown>;
      // A paid invoice sent as a bill reads as a second demand for money already handed over.
      if (text(row.status) === "paid") {
        return { isError: true, text: `INV-${rawNumber} is already paid. To send the customer their paid invoice, use send_paid_invoice. Nothing was sent.` };
      }
      const job = record(row.jobs);
      const customer = record(job.customers);
      const organization = record(row.organizations);
      const channels = channel === "both" ? ["sms", "email"] : channel === "email" ? ["email"] : ["sms"];
      const attempts = await deliverInvoice({
        invoiceId: text(row.id),
        organizationId,
        channels,
        customerPhone: text(customer.phone),
        customerEmail: text(customer.email),
        facts: {
          businessName: text(organization.name) || "Your electrician",
          businessPhone: text(organization.phone) || "our office",
          contactName: displayCustomer(customer),
          invoiceNumber: `INV-${row.invoice_number}`,
          amountDue: Number(row.total_cents ?? 0) / 100,
          dueLabel: "",
          payUrl: text(row.stripe_hosted_invoice_url) || undefined,
          workSummary: text(job.customer_description) || undefined,
        },
      });
      const result = describeDelivery(attempts);
      return { text: result.message, isError: attempts.every((attempt) => !attempt.ok) };
    }

    case "send_text": {
      const who = text(args.customer);
      const body = text(args.message).slice(0, 500);
      const proposal = `Text ${who}: “${body}”`;
      const gate = requireConfirmation(args, proposal);
      if (gate) return gate;
      if (!body) return { isError: true, text: "The message was empty. Nothing was sent." };
      const found = await findCustomer(database, organizationId, who);
      if (!found.row) return { isError: true, text: found.problem ?? "Customer not found." };
      const outcome = await sendCustomerText(asFlexibleClient(database), {
        organizationId,
        customerId: text(found.row.id),
        body,
        send: sendSms,
      });
      if (outcome.ok) return { text: `Text sent to ${displayCustomer(found.row)} at ${outcome.phone}. It is in their conversation in Volteira.` };
      return { isError: true, text: `${displayCustomer(found.row)}: ${outcome.message}` };
    }

    case "draft_contract": {
      const jobNumber = Number(text(args.job_number));
      // The scope is written by the assistant the electrician is talking to,
      // on their own plan, rather than by Volteira's built-in AI. One plain
      // paragraph, so nothing it sends can become a heading or a new clause.
      const written = text(args.scope).replace(/\s+/g, " ").trim().slice(0, 1200);
      if (!written) {
        if (!Number.isFinite(jobNumber)) return { isError: true, text: "That job number could not be read." };
        const { data: described } = await database
          .from("jobs")
          .select("job_number, category, customer_description")
          .eq("organization_id", organizationId)
          .eq("job_number", jobNumber)
          .maybeSingle();
        if (!described) return { isError: true, text: `Job #${jobNumber} was not found.` };
        return {
          text: [
            "Nothing has been created yet. Write the scope-of-work paragraph, then call draft_contract again with it as scope.",
            "",
            `KIND OF WORK: ${text(described.category).replace(/_/g, " ") || "not given"}`,
            `WHAT THE CUSTOMER DESCRIBED: ${text(described.customer_description).slice(0, 2000) || "nothing yet; ask the electrician"}`,
            "",
            "RULES",
            scopePrompt(),
          ].join("\n"),
        };
      }
      const proposal = `Create and store a draft contract for job #${text(args.job_number)} with this scope: "${written}"`;
      const gate = requireConfirmation(args, proposal);
      if (gate) return gate;
      if (!Number.isFinite(jobNumber)) return { isError: true, text: "That job number could not be read." };

      const { data: job } = await database
        .from("jobs")
        .select(
          "id,job_number,category,customer_description,scheduled_start,diagnostic_fee_cents,customers(first_name,last_name,company_name,bill_to,address_line_1,city,state,postal_code),properties(address_line_1,city,state,postal_code),organizations(name,phone,timezone,created_by),invoices(total_cents)",
        )
        .eq("organization_id", organizationId)
        .eq("job_number", jobNumber)
        .maybeSingle();
      if (!job) return { isError: true, text: `Job #${jobNumber} was not found.` };
      const row = job as Record<string, unknown>;
      const customer = record(row.customers);
      const property = record(row.properties);
      const organization = record(row.organizations);
      const invoices = Array.isArray(row.invoices) ? (row.invoices as Record<string, unknown>[]) : [];
      const { data: template } = await database
        .from("contract_templates")
        .select("body")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const body = text(template?.body).trim() || STARTER_TEMPLATE;
      const timeZone = text(organization.timezone) || "America/Los_Angeles";
      const formatDate = (iso: string) => iso
        ? new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso))
        : "";
      const totalCents = invoices.reduce((sum, invoice) => sum + Number(invoice.total_cents ?? 0), 0);
      const scope = written;
      const facts: Partial<ContractFacts> = {
        business_name: text(organization.name),
        business_phone: text(organization.phone),
        customer_name: billingParty(customer, null).name,
        service_address: serviceAddress(property, customer),
        job_number: String(row.job_number ?? jobNumber),
        job_date: formatDate(text(row.scheduled_start)),
        work_type: text(row.category).replace(/_/g, " "),
        total: totalCents > 0 ? formatMoney(totalCents / 100) : "",
        deposit: Number(row.diagnostic_fee_cents ?? 0) > 0 ? formatMoney(Number(row.diagnostic_fee_cents) / 100) : "",
        scope: scope ?? "",
        today: formatDate(new Date().toISOString()),
      };
      const filled = fillTemplate(body, facts);
      const { data: created, error } = await database
        .from("contracts")
        .insert({ organization_id: organizationId, job_id: text(row.id), body: filled.body, unfilled: filled.unfilled, status: "draft" })
        .select("id")
        .maybeSingle();
      if (error || !created) return { isError: true, text: "The contract could not be saved." };

      let pdfNote = "PDF was not rendered.";
      const uploadedBy = text(organization.created_by);
      if (uploadedBy) {
        const { generateContractPdf } = await import("@/lib/pdf/contract-data");
        const document = await generateContractPdf({ database, organizationId, contractId: text(created.id), timeZone, uploadedBy });
        pdfNote = document.error ? `PDF needs to be rebuilt: ${document.error}` : "PDF ready.";
      }
      const blanks = filled.unfilled.length ? ` ${filled.unfilled.length} template field(s) still need review.` : "";
      return { text: `Draft contract created for job #${jobNumber}.${blanks} ${pdfNote} It has not been sent for signature.` };
    }

    case "complete_contract_details": {
      const number = Number(text(String(args.job_number ?? "")).replace(/^#/, ""));
      if (!Number.isInteger(number) || number <= 0) return { isError: true, text: "That job number could not be read. Nothing was saved." };
      const { data: jobRow } = await database
        .from("jobs")
        .select("id, job_number, category, customer_description")
        .eq("organization_id", organizationId)
        .eq("job_number", number)
        .maybeSingle();
      const job = (jobRow ?? null) as Record<string, unknown> | null;
      if (!job) return { isError: true, text: `Job #${number} was not found. Nothing was saved.` };
      const jobId = text(job.id);

      // Only the newest contract can be completed, and only while it is an unsigned draft.
      const { data: sourceRow } = await database
        .from("contracts")
        .select("id, kind, body, scope, status, signed_at, created_at, total_cents, deposit_cents, deposit_paid")
        .eq("organization_id", organizationId)
        .eq("job_id", jobId)
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const source = (sourceRow ?? null) as Record<string, unknown> | null;
      if (!source) return { isError: true, text: `Job #${number} has no contract yet. Draft one with draft_contract.`, record: { jobId } };
      if (source.status !== "draft" || source.signed_at) {
        return { isError: true, text: "Only an unsigned draft can be completed. This contract has already been sent or signed.", record: { jobId } };
      }
      const body = text(source.body);
      const fields = placeholdersUsed(body);
      if (!fields.length) return { text: `Job #${number}'s contract has no missing details. It is ready to send for signature.`, record: { jobId } };

      const given = record(args.values);
      if (Object.keys(given).length === 0) {
        return {
          text: [
            `Job #${number}'s draft contract is missing: ${fields.join(", ")}. Nothing has been saved yet.`,
            "Ask the electrician for anything you do not know, then call complete_contract_details again with values for every one of these fields and confirmed true.",
            ...(fields.includes("scope")
              ? [
                  "",
                  "For scope, write one plain paragraph:",
                  `KIND OF WORK: ${text(job.category).replace(/_/g, " ") || "not given"}`,
                  `WHAT THE CUSTOMER DESCRIBED: ${text(job.customer_description).slice(0, 2000) || "nothing yet; ask the electrician"}`,
                  "RULES",
                  scopePrompt(),
                ]
              : []),
          ].join("\n"),
          record: { jobId },
        };
      }

      const values: Record<string, string> = Object.create(null);
      for (const field of fields) {
        const raw = given[field];
        let value = typeof raw === "string" ? raw.trim() : "";
        if (field === "scope") value = value.replace(/\s+/g, " ");
        if (!value || value.length > 5000 || value.includes("{{") || value.includes("}}")) {
          return { isError: true, text: `Give ${field} (up to 5,000 characters, without template brackets). Nothing was saved.`, record: { jobId } };
        }
        values[field] = value;
      }
      const gate = requireConfirmation(
        args,
        `Save a completed draft of job #${number}'s contract with ${fields.map((field) => `${field}: "${values[field].slice(0, 300)}"`).join("; ")}.`,
      );
      if (gate) return gate;

      // A line written since this draft was made is work it does not cover.
      const { count: writtenSince } = await database
        .from("job_line_items")
        .select("id", { count: "exact", head: true })
        .eq("job_id", jobId)
        .gt("created_at", text(source.created_at));
      if (writtenSince) {
        return {
          isError: true,
          text: source.kind === "change_order"
            ? "Items were added after this change order was made. Generate a new change order so it includes them. Nothing was saved."
            : "Items were added after this draft was made. Generate another draft with draft_contract so it includes them. Nothing was saved.",
          record: { jobId },
        };
      }

      const filled = completeDraftFields(body, values);
      if (filled.unfilled.length) return { isError: true, text: `Still missing: ${filled.unfilled.join(", ")}. Nothing was saved.`, record: { jobId } };
      const { data: created, error } = await database
        .from("contracts")
        .insert({
          organization_id: organizationId,
          job_id: jobId,
          kind: source.kind === "change_order" ? "change_order" : "agreement",
          body: filled.body,
          scope: values.scope ?? text(source.scope),
          unfilled: [],
          status: "draft",
          ...("total" in values || "deposit" in values
            ? { total_cents: null, deposit_cents: null, deposit_paid: null }
            : { total_cents: source.total_cents ?? null, deposit_cents: source.deposit_cents ?? null, deposit_paid: source.deposit_paid ?? null }),
        })
        .select("id")
        .maybeSingle();
      if (error || !created) return { isError: true, text: "The completed draft could not be saved. Try again.", record: { jobId } };

      // Filed under the owner who connected ChatGPT, or the business's creator.
      let uploadedBy = "";
      if (session.credentialId) {
        const { data: credential } = await database.from("mcp_business_credentials").select("created_by").eq("id", session.credentialId).maybeSingle();
        uploadedBy = text(credential?.created_by);
      }
      const { data: organization } = await database.from("organizations").select("timezone, created_by").eq("id", organizationId).maybeSingle();
      uploadedBy = uploadedBy || text(organization?.created_by);
      let pdfNote = "PDF not rebuilt: open the job's contract and choose Build the PDF.";
      if (uploadedBy) {
        const { generateContractPdf } = await import("@/lib/pdf/contract-data");
        const pdf = await generateContractPdf({
          database: asFlexibleClient(database),
          organizationId,
          contractId: text(created.id),
          timeZone: text(organization?.timezone) || "America/Los_Angeles",
          uploadedBy,
        });
        pdfNote = pdf.error ? `PDF needs to be rebuilt: ${pdf.error}` : "PDF rebuilt.";
      }
      return {
        text: `Saved a completed draft of job #${number}'s contract (${fields.join(", ")} filled in). ${pdfNote} It has not been sent; use send_contract_for_signature when the electrician says to send it.`,
        record: { jobId },
      };
    }

    case "send_contract_for_signature": {
      const number = Number(text(String(args.job_number ?? "")).replace(/^#/, ""));
      if (!Number.isInteger(number) || number <= 0) return { isError: true, text: "That job number could not be read. Nothing was sent." };
      const gate = requireConfirmation(args, `Sign job #${number}'s contract for the business and text the customer the link to sign it.`);
      if (gate) return gate;

      const { data: jobRow } = await database
        .from("jobs")
        .select("id, job_number, customer_id")
        .eq("organization_id", organizationId)
        .eq("job_number", number)
        .maybeSingle();
      const job = (jobRow ?? null) as Record<string, unknown> | null;
      if (!job) return { isError: true, text: `Job #${number} was not found. Nothing was sent.` };
      const jobId = text(job.id);

      // The newest contract that is not cancelled is the only one that can be
      // signed; an older one has been replaced.
      const { data: contractRow } = await database
        .from("contracts")
        .select("id, organization_id, kind, status, unfilled, public_token, signed_at, signature_provider, signature_sent_at, contractor_signed_at")
        .eq("organization_id", organizationId)
        .eq("job_id", jobId)
        .neq("status", "void")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const contract = (contractRow ?? null) as Record<string, unknown> | null;

      // Who signs for the business: the owner who connected ChatGPT, with
      // their own saved signature.
      let signerId = "";
      if (session.credentialId) {
        const { data: credential } = await database
          .from("mcp_business_credentials")
          .select("created_by")
          .eq("id", session.credentialId)
          .eq("organization_id", organizationId)
          .is("revoked_at", null)
          .maybeSingle();
        signerId = text(credential?.created_by);
      }
      let signerReady = false;
      if (signerId) {
        const [{ data: member }, { data: signature }] = await Promise.all([
          database.from("organization_members").select("user_id").eq("organization_id", organizationId).eq("user_id", signerId).maybeSingle(),
          database.from("contract_signers").select("user_id").eq("organization_id", organizationId).eq("user_id", signerId).maybeSingle(),
        ]);
        signerReady = Boolean(member && signature);
      }

      const customerId = text(job.customer_id);
      const texting = customerId
        ? await textingAllowed(asFlexibleClient(database), organizationId, customerId)
        : ({ ok: false, code: "NO_PHONE", message: "The job has no customer." } as const);
      const { data: messaging } = await database
        .from("messaging_settings")
        .select("messaging_service_sid")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const messagingServiceSid = text(messaging?.messaging_service_sid);

      const refusal = contractSendRefusal({
        contract: contract
          ? {
              status: text(contract.status) || "draft",
              signedAt: text(contract.signed_at) || null,
              signatureProvider: text(contract.signature_provider) || null,
              unfilled: Array.isArray(contract.unfilled) ? (contract.unfilled as string[]) : [],
              signatureSentAt: text(contract.signature_sent_at) || null,
            }
          : null,
        signerReady,
        textingAllowed: texting.ok,
        textingRefusal: texting.ok ? undefined : texting.message,
        hasMessagingService: Boolean(messagingServiceSid),
        now: Date.now(),
      });
      if (refusal || !contract) return { isError: true, text: refusal || "Nothing was sent.", record: { jobId } };

      const phone = texting.ok ? toE164(texting.phone) : "";
      const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const token = text(contract.public_token);
      if (!phone || !origin || !token) return { isError: true, text: "The signing link could not be built. Nothing was sent.", record: { jobId } };
      const contractId = text(contract.id);

      const { data: organization } = await database.from("organizations").select("name, timezone").eq("id", organizationId).maybeSingle();

      // The business signs first, so the contract the customer opens already
      // carries the sender's signature. Signed once: a re-send keeps it.
      if (!contract.contractor_signed_at) {
        const { data: signedAt, error } = await database.rpc("sign_contract_as_contractor_for", {
          p_contract_id: contractId,
          p_user_id: signerId,
        });
        if (error || !signedAt) return { isError: true, text: "The contract could not be signed for the business. Nothing was sent.", record: { jobId } };
        try {
          const { generateContractPdf } = await import("@/lib/pdf/contract-data");
          const pdf = await generateContractPdf({
            database: asFlexibleClient(database),
            organizationId,
            contractId,
            timeZone: text(organization?.timezone) || "America/Los_Angeles",
            uploadedBy: signerId,
          });
          if (pdf.error) console.error("business-signed contract PDF failed", { contractId, error: pdf.error });
        } catch (error) {
          console.error("business-signed contract PDF failed", { contractId, error });
        }
      }

      // An older contract on this job still out for signature has been replaced.
      await database
        .from("contracts")
        .update({ status: "draft" })
        .eq("job_id", jobId)
        .eq("status", "sent")
        .eq("signature_provider", "in_app")
        .is("signed_at", null)
        .neq("id", contractId);

      // The claim, before anybody is texted: matches only if nothing changed
      // since it was read, so two sends at once text the customer once.
      const previousStatus = text(contract.status) || "draft";
      const previousProvider = text(contract.signature_provider) || null;
      const previousSentAt = text(contract.signature_sent_at) || null;
      const claim = database
        .from("contracts")
        .update({ status: "sent", signature_provider: "in_app", signature_sent_at: new Date().toISOString() })
        .eq("id", contractId)
        .is("signed_at", null);
      const { data: claimed, error: claimError } = await (previousSentAt ? claim.eq("signature_sent_at", previousSentAt) : claim.is("signature_sent_at", null))
        .select("id")
        .maybeSingle();
      if (claimError || !claimed) {
        return {
          isError: true,
          text: claimError?.code === "23505"
            ? "Another contract for this job is already out for signature, so this one was not sent."
            : "That contract changed a moment ago — it may have just been sent or signed. Nothing was sent.",
          record: { jobId },
        };
      }

      const sent = await sendSms({
        to: phone,
        body: signingLinkMessage({ businessName: text(organization?.name), jobNumber: job.job_number, link: `${origin}/contract/${token}`, kind: contract.kind }),
        messagingServiceSid,
      });
      if (!sent.ok) {
        await database
          .from("contracts")
          .update({ status: previousStatus, signature_provider: previousProvider, signature_sent_at: previousSentAt })
          .eq("id", contractId)
          .is("signed_at", null);
        await recordActivity(asFlexibleClient(database), {
          organizationId,
          eventType: "estimate.send_failed",
          label: "Approval text not sent",
          jobId,
          metadata: { via: "sms", contract_id: contractId, source: "chatgpt", reason: `The text could not be sent (${sent.errorDetail || sent.errorCode})` },
        });
        return { isError: true, text: `The text could not be sent (${sent.errorDetail || sent.errorCode}). The contract is not marked sent.`, record: { jobId } };
      }

      await recordActivity(asFlexibleClient(database), {
        organizationId,
        eventType: "estimate.sent",
        label: "Sent for approval",
        jobId,
        metadata: { via: "sms", contract_id: contractId, source: "chatgpt" },
      });
      return {
        text: `Signed for the business and texted the signing link for job #${job.job_number}'s contract to ${formatForDisplay(phone)}. The job page shows when the customer signs.`,
        record: { jobId },
      };
    }

    case "supplier_integration_status": {
      return {
        text: getSupplierIntegrations()
          .map((supplier) => `${supplier.name}: ${supplier.statusLabel}. ${supplier.capabilities.join(", ")}. ${supplier.caveat}`)
          .join("\n\n"),
      };
    }

    case "get_job_materials": {
      const found = await materialsJob(database, organizationId, args.job_number);
      if (!found) return { isError: true, text: `Job #${String(args.job_number ?? "")} was not found.` };
      const { job, saved } = found;
      const { data: organization } = await database.from("organizations").select("name").eq("id", organizationId).maybeSingle();
      const place = record(Array.isArray(job.properties) ? job.properties[0] : job.properties);
      const facts = materialJobFacts({
        customerType: (Array.isArray(job.customers) ? (job.customers as Record<string, unknown>[])[0] : (job.customers as Record<string, unknown> | null | undefined))?.customer_type,
        category: job.category,
        customerDescription: job.customer_description,
        technicianNotes: job.technician_notes,
        city: place.city,
        state: place.state,
      });
      return {
        text: [
          `JOB #${job.job_number}`,
          facts.length ? facts.join("\n") : "The job record says nothing about the work yet: ask the electrician what the job is.",
          "",
          "HOW TO WRITE THE LIST",
          materialListInstructions(text(organization?.name)),
          "",
          hasContent(saved.list)
            ? `THE JOB'S SAVED LIST (start from this one when asked for changes; items edited by hand in Volteira are in it)\n\n${materialListMarkdown(saved.list)}`
            : "THE JOB'S SAVED LIST: none yet.",
          "",
          `list_version: ${saved.updatedAt ?? NO_LIST_VERSION}`,
          "",
          `When the list is written, show it and ask the electrician whether to save it to the job. Once they say yes, save it with save_materials_list (job_number ${job.job_number}, the whole list, list_version above, confirmed true). If saving is not possible here, tell the electrician to tap Copy under your answer and use "Write it in ChatGPT instead" in the job's Materials chat in Volteira.`,
        ].join("\n"),
        record: { jobId: text(job.id) },
      };
    }

    case "save_materials_list": {
      const written = typeof args.list === "string" ? args.list : "";
      if (!written.trim()) return { isError: true, text: "The list was empty. Nothing was saved." };
      if (written.length > 40_000) return { isError: true, text: "That list is too long to save. Nothing was saved." };
      // The version the list was written from: saving over any other would
      // drop a change made in Volteira while ChatGPT was writing.
      const readVersion = text(args.list_version).slice(0, 64);
      if (!readVersion || (readVersion !== NO_LIST_VERSION && Number.isNaN(Date.parse(readVersion)))) {
        return { isError: true, text: "Call get_job_materials first and pass the list_version it gives. Nothing was saved." };
      }
      const found = await materialsJob(database, organizationId, args.job_number);
      if (!found) return { isError: true, text: `Job #${String(args.job_number ?? "")} was not found. Nothing was saved.` };
      const { job, saved } = found;
      const jobId = text(job.id);

      // What did not change keeps its store prices, as with a list written in Volteira.
      const list = carryPrices(saved.list, readPastedMaterialList(written, `c${Date.now().toString(36)}`));
      // A heading with no items under it is not a list, and would leave the job with none.
      if (listItems(list).length === 0) {
        return {
          isError: true,
          text: "That is not in the list format: it needs \"## \" section headings with \"- \" bullets under them, as get_job_materials describes. Nothing was saved.",
        };
      }
      // Like every tool that changes the business's records: the job's text
      // can carry a customer's words, so the owner says yes to this save.
      const count = estimateItems(list).length;
      const gate = requireConfirmation(
        args,
        `Save ${count} ${count === 1 ? "item" : "items"} to job #${job.job_number}'s materials list${hasContent(saved.list) ? ", replacing the list saved there now" : ""}.`,
      );
      if (gate) return gate;
      const asked = text(args.request).slice(0, 500);
      const now = new Date().toISOString();
      const messages: ChatTurn[] = [
        ...saved.messages,
        { role: "user", text: asked ? `In ChatGPT: ${asked}` : "Written in ChatGPT.", at: now },
        { role: "assistant", text: list.intro || "Here is the list.", at: now },
      ];
      // Only over the list it was read from: one changed in Volteira since is
      // not replaced.
      const write = await writeMaterialList(asFlexibleClient(database), {
        organizationId,
        jobId,
        userId: "",
        list,
        messages,
        source: "openai",
        model: "chatgpt",
        expectedUpdatedAt: readVersion === NO_LIST_VERSION ? null : readVersion,
      });
      if (write.status === "changed") {
        return {
          isError: true,
          text: `The list on job #${job.job_number} was changed in Volteira since it was read, so this one was not saved. Call get_job_materials again and start from the list as it is now.`,
          record: { jobId },
        };
      }
      if (write.status === "failed") return { isError: true, text: "The list could not be saved just now. Try again.", record: { jobId } };
      return {
        text: `Saved ${count} ${count === 1 ? "item" : "items"} to job #${job.job_number}. Nothing was ordered or sent to the customer. In Volteira, open job #${job.job_number} → Materials chat to change items, price them and add them to the estimate.\nlist_version for the next change: ${write.updatedAt}`,
        record: { jobId },
      };
    }

    case "store_cart": {
      const store = cartStore(args.store);
      if (!store) return { isError: true, text: 'Say which store: "home-depot" or "lowes".' };
      const found = await materialsJob(database, organizationId, args.job_number);
      if (!found) return { isError: true, text: `Job #${String(args.job_number ?? "")} was not found.` };
      const { job, saved } = found;
      const { label, lines, unmatched } = storeCart(saved.list, store);
      const number = String(job.job_number);
      const jobPlace = record(Array.isArray(job.properties) ? job.properties[0] : job.properties);
      const facts = materialJobFacts({
        customerType: (Array.isArray(job.customers) ? (job.customers as Record<string, unknown>[])[0] : (job.customers as Record<string, unknown> | null | undefined))?.customer_type,
        category: job.category,
        customerDescription: job.customer_description,
        technicianNotes: job.technician_notes,
        city: jobPlace.city,
        state: jobPlace.state,
      });
      const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
      const page = origin ? `${origin}/jobs/${number}/cart/${cartSlug(store)}` : "";
      if (lines.length === 0) {
        return {
          text: `Nothing on job #${number}'s materials list is matched to a ${label} product yet${hasContent(saved.list) ? "" : " (the job has no saved list)"}. Write and save the list, price it in the job's Materials chat in Volteira, and ask again.`,
          record: { jobId: text(job.id) },
        };
      }
      return {
        text: [
          `${label.toUpperCase()} CART FOR JOB #${number}`,
          page ? `The same list as a page to work from: ${page} (opens when signed in to Volteira).` : "",
          "",
          "THE JOB (for recommending products and quantities)",
          ...(facts.length ? facts : ["The job record says nothing about the work; ask the electrician before guessing quantities."]),
          "",
          "HOW TO FILL THE CART",
          `This needs a web browser signed in to the electrician's ${label} account. If you have one (Muse's browser, ChatGPT agent mode or similar), use it and follow these steps now. If you have no browser here, tell the electrician to ask again where you do, e.g. in ChatGPT agent mode: "Fill my ${label} cart for job #${number} from Volteira."`,
          ...cartAgentSteps(store).map((step, index) => `${index + 1}. ${step}`),
          "",
          "ADD TO CART",
          ...lines.map(
            (line, index) =>
              `${index + 1}. ${line.product}: needed ${line.needsQty ? "NO QUANTITY ON THE LIST, recommend one" : line.qty} (list: "${line.listed}")${line.sku ? `, item ${line.sku}` : ""}, matched ${formatMoney(line.cents / 100)} per ${line.per}${line.note ? `, note: ${line.note}` : ""}\n   ${line.url}`,
          ),
          ...(unmatched.length
            ? [
                "",
                `NOT MATCHED AT ${label.toUpperCase()} (search ${label} and recommend a product for each, as the steps say)`,
                ...unmatched.map((item) => `- ${item.listed}${item.note ? ` (${item.note})` : ""}${item.needsQty ? ": NO QUANTITY ON THE LIST, recommend one" : ""}`),
              ]
            : []),
        ]
          .filter((line, index, all) => line !== "" || all[index - 1] !== "")
          .join("\n"),
        record: { jobId: text(job.id) },
      };
    }

    default:
      return { isError: true, text: `Unknown business MCP tool: ${name}` };
  }
}
