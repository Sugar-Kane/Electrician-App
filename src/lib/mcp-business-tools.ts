import "server-only";

import { buildBusinessHours, parseBusinessHours } from "@/lib/business-hours";
import { draftScope, draftWorkOrderLines } from "@/lib/claude";
import { fillTemplate, STARTER_TEMPLATE, type ContractFacts } from "@/lib/contract-template";
import { deliverInvoice } from "@/lib/invoice-delivery";
import { invoiceTotals } from "@/lib/invoice-math";
import { describeDelivery, formatMoney } from "@/lib/invoice-messages";
import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { McpSession } from "@/lib/mcp-session-token";
import { parseCostToCents } from "@/lib/new-job-input";
import { getSupplierIntegrations } from "@/lib/supplier-integrations";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { sendSms } from "@/lib/twilio";

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
      "Draft labor and material line suggestions from a work description. This does not save or send anything; prices are suggestions for owner review.",
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
      "Send an existing invoice to its customer by SMS, email or both. The existing Stripe hosted payment URL is included when available. Explicit owner approval is required.",
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
      "Create a stored draft contract for an existing job from the business template and render its PDF when possible. Explicit owner approval is required.",
    inputSchema: {
      type: "object",
      properties: { job_number: str("The existing job number."), confirmed },
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
      const lines = await draftWorkOrderLines({ description });
      if (!lines?.length) return { isError: true, text: "No estimate lines could be drafted. Nothing was saved." };
      return {
        text: `DRAFT ONLY — review quantities and prices before using them:\n${lines
          .map((line, index) => `${index + 1}. ${JSON.stringify(line)}`)
          .join("\n")}`,
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
        .select("invoice_number,total_cents")
        .maybeSingle();
      if (error || !created) return { isError: true, text: "The invoice could not be created." };
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
      const customerId = text(found.row.id);
      const phone = text(found.row.phone);
      if (!phone) return { isError: true, text: `${displayCustomer(found.row)} has no phone number. Nothing was sent.` };

      const { data: consent } = await database
        .from("messaging_consent")
        .select("opted_in_at,opted_out_at")
        .eq("organization_id", organizationId)
        .eq("customer_id", customerId)
        .eq("channel", "sms")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!consent?.opted_in_at || consent.opted_out_at) {
        return { isError: true, text: `${displayCustomer(found.row)} does not have active SMS consent. Nothing was sent.` };
      }

      const { data: settings } = await database
        .from("messaging_settings")
        .select("messaging_service_sid")
        .eq("organization_id", organizationId)
        .maybeSingle();
      const sid = text(settings?.messaging_service_sid);
      if (!sid) return { isError: true, text: "Messaging is not configured for this business. Nothing was sent." };
      const result = await sendSms({ to: phone, body, messagingServiceSid: sid });
      return result.ok
        ? { text: `Text sent to ${displayCustomer(found.row)} at ${phone}.` }
        : { isError: true, text: `The text could not be sent (${result.errorCode}: ${result.errorDetail}).` };
    }

    case "draft_contract": {
      const jobNumber = Number(text(args.job_number));
      const proposal = `Create and store a draft contract for job #${text(args.job_number)}.`;
      const gate = requireConfirmation(args, proposal);
      if (gate) return gate;
      if (!Number.isFinite(jobNumber)) return { isError: true, text: "That job number could not be read." };

      const { data: job } = await database
        .from("jobs")
        .select(
          "id,job_number,category,customer_description,scheduled_start,diagnostic_fee_cents,customers(first_name,last_name,company_name),properties(address_line_1,city,state,postal_code),organizations(name,phone,timezone,created_by),invoices(total_cents)",
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
      const scope = await draftScope({ description: text(row.customer_description), workType: text(row.category).replace(/_/g, " ") });
      const facts: Partial<ContractFacts> = {
        business_name: text(organization.name),
        business_phone: text(organization.phone),
        customer_name: displayCustomer(customer),
        service_address: [text(property.address_line_1), text(property.city), text(property.state), text(property.postal_code)].filter(Boolean).join(", "),
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

    case "supplier_integration_status": {
      return {
        text: getSupplierIntegrations()
          .map((supplier) => `${supplier.name}: ${supplier.statusLabel}. ${supplier.capabilities.join(", ")}. ${supplier.caveat}`)
          .join("\n\n"),
      };
    }

    default:
      return { isError: true, text: `Unknown business MCP tool: ${name}` };
  }
}
