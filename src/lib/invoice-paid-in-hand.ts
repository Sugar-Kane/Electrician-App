import "server-only";

import { recordActivity } from "@/lib/activity";
import { deliverInvoice } from "@/lib/invoice-delivery";
import { describeDelivery, invoiceViewUrl, paidInvoiceCanBeSent, type InvoiceFacts } from "@/lib/invoice-messages";
import { checkPaidInHand, paymentMethodLabel } from "@/lib/invoice-payment";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { invoiceLabel } from "@/lib/invoice-label";

/**
 * Invoices the customer already paid in hand (cash on the spot, a check, a
 * card run outside the app): mark them paid in full, and send the customer the
 * paid invoice as their record.
 *
 * Used by the job and invoice pages (the signed-in person's own client, so
 * row-level security and `auth.uid()` apply) and by the ChatGPT/Claude
 * connection (the server client, naming the business and the person). Every
 * read is filtered to the business either way; the database function makes
 * the final check inside one transaction.
 */

type Database = FlexibleSupabaseClient;
type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function one(value: unknown): Row | null {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === "object" && first !== null ? (first as Row) : null;
}

function customerName(customer: Row | null): string {
  if (!customer) return "";
  return text(customer.company_name).trim() || [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ").trim();
}

function dollars(cents: number): string {
  return (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export type PaidInHandOutcome =
  | { ok: true; amountCents: number; invoiceNumber: string; jobNumber: string; message: string }
  | { ok: false; message: string };

/** Mark an invoice paid in full by a payment already taken in hand. */
export async function markInvoicePaidInHand(
  db: Database,
  input: {
    invoiceId: string;
    organizationId: string;
    method: string;
    note?: string;
    /** The person recording it, when the caller is the server (ChatGPT). Ignored for a signed-in caller, who is recorded themselves. */
    recordedBy?: string | null;
    timeZone: string;
  },
): Promise<PaidInHandOutcome> {
  const { data } = await db
    .from("invoices")
    .select("id, invoice_number, number_label, status, total_cents, balance_due_cents, stripe_invoice_id, jobs ( id, job_number )")
    .eq("organization_id", input.organizationId)
    .eq("id", input.invoiceId)
    .maybeSingle();
  const row = data as Row | null;
  if (!row) return { ok: false, message: "That invoice could not be found." };
  const job = one(row.jobs);
  const invoiceNumber = `INV-${invoiceLabel(row)}`;

  const check = checkPaidInHand({
    invoice: {
      status: text(row.status),
      totalCents: Number(row.total_cents ?? 0),
      balanceDueCents: row.balance_due_cents === null || row.balance_due_cents === undefined ? null : Number(row.balance_due_cents),
      stripeInvoiceId: text(row.stripe_invoice_id) || null,
    },
    method: input.method,
  });
  if (!check.ok) return { ok: false, message: `${invoiceNumber}: ${check.reason}` };

  const { error } = await db.rpc("record_invoice_paid_in_hand", {
    p_invoice_id: input.invoiceId,
    p_method: check.method,
    p_note: input.note?.trim().slice(0, 500) || null,
    p_organization_id: input.organizationId,
    p_recorded_by: input.recordedBy ?? null,
  });
  if (error) {
    console.error("record paid in hand failed", { invoiceId: input.invoiceId, code: error.code });
    return { ok: false, message: error.code === "22023" ? `${invoiceNumber} was not marked paid: ${error.message}.` : `${invoiceNumber} could not be marked paid. Try again.` };
  }

  await recordActivity(db, {
    organizationId: input.organizationId,
    eventType: "invoice.paid",
    label: "Invoice paid",
    jobId: text(job?.id) || null,
    metadata: { amount_cents: check.amountCents, method: check.method, invoice_id: input.invoiceId, paid_in_hand: true },
  });

  // The document says Paid from now on. Best effort: the payment is recorded
  // whether or not the PDF rebuilds, and the page offers a rebuild.
  try {
    const { generateInvoicePdf } = await import("@/lib/pdf/invoice-data");
    await generateInvoicePdf({ database: db, organizationId: input.organizationId, invoiceId: input.invoiceId, timeZone: input.timeZone, uploadedBy: input.recordedBy ?? "" });
  } catch (failure) {
    console.error("paid invoice document not rebuilt", { invoiceId: input.invoiceId, message: failure instanceof Error ? failure.message : "unknown" });
  }

  return {
    ok: true,
    amountCents: check.amountCents,
    invoiceNumber,
    jobNumber: text(job?.job_number),
    message: `${invoiceNumber} marked paid: ${dollars(check.amountCents)} in ${paymentMethodLabel(check.method)}.`,
  };
}

/** Send a paid invoice to its customer as their record. Never asks for money. */
export async function sendPaidInvoice(
  db: Database,
  input: { invoiceId: string; organizationId: string; channels: string[] },
): Promise<{ ok: boolean; message: string; jobNumber: string }> {
  const { data } = await db
    .from("invoices")
    .select(
      `id, invoice_number, number_label, status, total_cents, paid_at, preview_token,
       jobs ( id, job_number, customer_id, customer_description, customers ( first_name, last_name, company_name, phone, email ) ),
       organizations ( name, phone, timezone )`,
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.invoiceId)
    .maybeSingle();
  const row = data as Row | null;
  if (!row) return { ok: false, message: "That invoice could not be found.", jobNumber: "" };
  const job = one(row.jobs);
  const customer = one(job?.customers);
  const organization = one(row.organizations);
  const jobNumber = text(job?.job_number);

  const permitted = paidInvoiceCanBeSent({ status: text(row.status), totalCents: Number(row.total_cents ?? 0) });
  if (!permitted.ok) return { ok: false, message: permitted.reason, jobNumber };
  if (input.channels.length === 0) return { ok: false, message: "Choose whether to send it by text, email, or both.", jobNumber };

  const { data: payment } = await db
    .from("invoice_payments")
    .select("method, recorded_at")
    .eq("organization_id", input.organizationId)
    .eq("invoice_id", input.invoiceId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const paidAt = text(row.paid_at) || text((payment as Row | null)?.recorded_at);
  const facts: InvoiceFacts = {
    businessName: text(organization?.name) || "Your electrician",
    businessPhone: text(organization?.phone) || "our office",
    contactName: customerName(customer),
    invoiceNumber: `INV-${invoiceLabel(row)}`,
    amountDue: Number(row.total_cents ?? 0) / 100,
    dueLabel: "",
    workSummary: text(job?.customer_description) || undefined,
    viewUrl: invoiceViewUrl(process.env.NEXT_PUBLIC_APP_URL ?? "", text(row.preview_token)),
    paidLabel: paidAt ? new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(paidAt)) : undefined,
    paidHow: paymentMethodLabel(text((payment as Row | null)?.method)) || undefined,
  };

  const attempts = await deliverInvoice({
    invoiceId: input.invoiceId,
    organizationId: input.organizationId,
    channels: input.channels,
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
    customerId: text(job?.customer_id) || undefined,
    facts,
    kind: "paid",
  });
  const outcome = describeDelivery(attempts, "Paid invoice");
  await recordActivity(db, {
    organizationId: input.organizationId,
    eventType: outcome.ok ? "invoice.paid_copy_sent" : "invoice.paid_copy_failed",
    label: outcome.ok ? "Paid invoice sent" : "Paid invoice not sent",
    jobId: text(job?.id) || null,
    metadata: { invoice_id: input.invoiceId, amount_cents: Number(row.total_cents ?? 0), ...(outcome.ok ? {} : { reason: outcome.message }) },
  });
  return { ok: outcome.ok, message: outcome.message, jobNumber };
}
