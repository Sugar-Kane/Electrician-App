import "server-only";

import { invoiceViewUrl } from "@/lib/invoice-messages";
import { checkPaidInHand, isPaymentMethod, paymentMethodLabel } from "@/lib/invoice-payment";
import { markInvoicePaidInHand, sendPaidInvoice } from "@/lib/invoice-paid-in-hand";
import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Invoices the customer already paid in hand, from ChatGPT or Claude: mark one
 * paid and send the customer the paid invoice. Both change money records or
 * reach a customer, so both show what they would do and act only with
 * `confirmed: true`, after the user has said yes to exactly that.
 */

const str = (description: string) => ({ type: "string", description });
const channel = { type: "string", enum: ["sms", "email", "both"] };
const confirmed = {
  type: "boolean",
  description:
    "Set true only after the user explicitly approved this exact action (invoice, amount, how they paid, and whether to send it) in this conversation. Leave false first to get the proposal to show them.",
};

export const PAID_INVOICE_MCP_TOOLS: McpTool[] = [
  {
    name: "mark_invoice_paid",
    title: "Mark invoice paid (already paid in hand)",
    description:
      "Use when the customer already paid in hand (cash, check, or a card run outside Volteira). Marks the invoice paid in full, even if it is still a draft, and can send the customer the paid invoice (it says paid and $0.00 owed, with no pay link). Ask the user how the customer paid if they didn't say; never assume a payment. Find the invoice by invoice_number or job_number; if the job has no invoice yet, create one with create_invoice first. Call once without confirmed to get the proposal, show it to the user, then call again with confirmed true only if they say yes.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_number: str("Invoice number, with or without INV-. Or give job_number."),
        job_number: str("The job number, if the invoice number isn't known."),
        method: { type: "string", enum: ["cash", "check", "card", "other"], description: "How the customer paid." },
        note: str("Optional note, such as a check number."),
        send: { type: "string", enum: ["none", "sms", "email", "both"], description: "Send the customer the paid invoice afterwards. Default none." },
        confirmed,
      },
      required: ["method", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "send_paid_invoice",
    title: "Send paid invoice",
    description:
      "Send a paid invoice to its customer by text, email or both, as their record of the payment. It says paid and $0.00 owed, with no pay link. Only works on an invoice already marked paid. Call once without confirmed to get the proposal, show it to the user, then again with confirmed true only if they say yes.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_number: str("Invoice number, with or without INV-. Or give job_number."),
        job_number: str("The job number, if the invoice number isn't known."),
        channel,
        confirmed,
      },
      required: ["channel", "confirmed"],
      additionalProperties: false,
    },
  },
];

const NAMES = new Set(PAID_INVOICE_MCP_TOOLS.map((tool) => tool.name));
export function isPaidInvoiceTool(name: string): boolean {
  return NAMES.has(name);
}

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

function one(value: unknown): Row | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Row) : null;
}

const COLUMNS =
  "id, invoice_number, status, total_cents, balance_due_cents, stripe_invoice_id, preview_token, jobs ( job_number, customers ( first_name, last_name, company_name, phone, email ) )";

/** The invoice the user means: by number, or the one open (or paid) invoice on a job. Several are listed, never guessed between. */
async function findInvoice(
  db: FlexibleSupabaseClient,
  organizationId: string,
  args: Row,
  want: "unpaid" | "paid",
): Promise<{ row: Row } | { problem: string }> {
  const rawNumber = text(args.invoice_number).replace(/^INV-/i, "");
  if (rawNumber) {
    const number = Number(rawNumber);
    if (!Number.isInteger(number)) return { problem: "That invoice number could not be read." };
    const { data } = await db.from("invoices").select(COLUMNS).eq("organization_id", organizationId).eq("invoice_number", number).maybeSingle();
    return data ? { row: data as Row } : { problem: `INV-${rawNumber} was not found.` };
  }
  const jobNumber = Number(text(args.job_number).replace(/^#/, ""));
  if (!Number.isInteger(jobNumber)) return { problem: "Give the invoice number or the job number." };
  const { data: job } = await db.from("jobs").select("id").eq("organization_id", organizationId).eq("job_number", jobNumber).maybeSingle();
  if (!job) return { problem: `Job #${jobNumber} was not found.` };
  const { data } = await db
    .from("invoices")
    .select(COLUMNS)
    .eq("organization_id", organizationId)
    .eq("job_id", text((job as Row).id))
    .order("created_at", { ascending: false });
  const invoices = (Array.isArray(data) ? (data as Row[]) : []).filter((row) =>
    want === "paid" ? text(row.status) === "paid" : !["paid", "void"].includes(text(row.status)),
  );
  if (invoices.length === 0) {
    return {
      problem:
        want === "paid"
          ? `Job #${jobNumber} has no paid invoice. Mark one paid first (mark_invoice_paid).`
          : `Job #${jobNumber} has no unpaid invoice. Create one with create_invoice first, then mark it paid.`,
    };
  }
  if (invoices.length > 1) {
    const list = invoices.map((row) => `INV-${text(row.invoice_number)} (${text(row.status)}, ${dollars(Number(row.total_cents ?? 0))})`).join(", ");
    return { problem: `Job #${jobNumber} has more than one: ${list}. Ask the user which, then use its invoice_number.` };
  }
  return { row: invoices[0]! };
}

function who(row: Row): { name: string; phone: string; email: string } {
  const customer = one(one(row.jobs)?.customers);
  const name = text(customer?.company_name) || [text(customer?.first_name), text(customer?.last_name)].filter(Boolean).join(" ") || "the customer";
  return { name, phone: text(customer?.phone), email: text(customer?.email) };
}

function channels(value: string): string[] {
  return value === "both" ? ["sms", "email"] : value === "sms" || value === "email" ? [value] : [];
}

function sayChannels(list: string[], customer: { phone: string; email: string }): string {
  return list.map((item) => (item === "sms" ? `text${customer.phone ? "" : " (no phone on file)"}` : `email${customer.email ? "" : " (no email on file)"}`)).join(" and ");
}

export async function runPaidInvoiceTool(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  /** The person who made this connection, if still a member; recorded on the payment. */
  actorUserId: string | null;
  timeZone: string;
  name: string;
  args: Row;
}): Promise<ToolResult> {
  const { database: db, organizationId, args } = input;

  if (input.name === "mark_invoice_paid") {
    const method = text(args.method);
    if (!isPaymentMethod(method)) return { isError: true, text: "Say how the customer paid: cash, check, card or other. Nothing was changed." };
    const found = await findInvoice(db, organizationId, args, "unpaid");
    if ("problem" in found) return { isError: true, text: `${found.problem} Nothing was changed.` };
    const row = found.row;
    const number = `INV-${text(row.invoice_number)}`;
    const check = checkPaidInHand({
      invoice: {
        status: text(row.status),
        totalCents: Number(row.total_cents ?? 0),
        balanceDueCents: row.balance_due_cents === null || row.balance_due_cents === undefined ? null : Number(row.balance_due_cents),
        stripeInvoiceId: text(row.stripe_invoice_id) || null,
      },
      method,
    });
    if (!check.ok) return { isError: true, text: `${number}: ${check.reason} Nothing was changed.` };
    const customer = who(row);
    const send = channels(text(args.send));
    const proposal =
      `Mark ${number} for ${customer.name} paid in full: ${dollars(check.amountCents)} in ${paymentMethodLabel(method)}` +
      `${text(args.note) ? ` (note: ${text(args.note)})` : ""}` +
      (send.length ? `, then send them the paid invoice by ${sayChannels(send, customer)}.` : ". Nothing is sent to the customer.");
    if (args.confirmed !== true) {
      return {
        text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: ${proposal} Ask the user to confirm the amount and how they paid.`,
        structured: { proposal, invoice_number: number, amount_cents: check.amountCents, method, send },
      };
    }
    const marked = await markInvoicePaidInHand(db, {
      invoiceId: text(row.id),
      organizationId,
      method,
      note: text(args.note),
      recordedBy: input.actorUserId,
      timeZone: input.timeZone,
    });
    if (!marked.ok) return { isError: true, text: marked.message };
    if (send.length === 0) {
      return { text: `${marked.message} Nothing was sent to the customer. To send the paid invoice, use send_paid_invoice.`, structured: { invoice_number: number, status: "paid", sent: false } };
    }
    const sent = await sendPaidInvoice(db, { invoiceId: text(row.id), organizationId, channels: send });
    return {
      isError: !sent.ok,
      text: sent.ok ? `${marked.message} ${sent.message}` : `${marked.message} The paid invoice was not sent: ${sent.message}`,
      structured: { invoice_number: number, status: "paid", sent: sent.ok },
    };
  }

  if (input.name === "send_paid_invoice") {
    const found = await findInvoice(db, organizationId, args, "paid");
    if ("problem" in found) return { isError: true, text: `${found.problem} Nothing was sent.` };
    const row = found.row;
    const number = `INV-${text(row.invoice_number)}`;
    if (text(row.status) !== "paid") return { isError: true, text: `${number} is not paid yet. Mark it paid first (mark_invoice_paid). Nothing was sent.` };
    const send = channels(text(args.channel));
    if (send.length === 0) return { isError: true, text: "Choose sms, email or both. Nothing was sent." };
    const customer = who(row);
    const view = invoiceViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", text(row.preview_token));
    const proposal = `Send ${number} (paid, ${dollars(Number(row.total_cents ?? 0))}) to ${customer.name} by ${sayChannels(send, customer)}.`;
    if (args.confirmed !== true) {
      return { text: `CONFIRMATION REQUIRED. Nothing was sent. Proposed action: ${proposal}`, structured: { proposal, invoice_number: number, view_url: view ?? null } };
    }
    const sent = await sendPaidInvoice(db, { invoiceId: text(row.id), organizationId, channels: send });
    return { isError: !sent.ok, text: sent.ok ? `${number}: ${sent.message}` : `${number}: ${sent.message}`, structured: { invoice_number: number, sent: sent.ok } };
  }

  return { isError: true, text: `Unknown tool: ${input.name}` };
}
