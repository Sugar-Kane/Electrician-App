"use server";

import { revalidatePath } from "next/cache";

import { deliverInvoice } from "@/lib/invoice-delivery";
import {
  describeDelivery,
  invoiceCanBeSent,
  type DeliveryChannel,
} from "@/lib/invoice-messages";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Sending an invoice to the customer.
 *
 * The read goes through the caller's session, so RLS decides whether they may
 * see this invoice at all — the id in the form is a lookup key and never an
 * authorisation. That matters more here than on most actions: an invoice id is
 * a uuid somebody could paste, and the answer to "may I send this business's
 * bill to this business's customer" has to come from the database.
 *
 * The actual send then runs with the admin client, because delivery writes a
 * log row on an invoice the sender can read but should not be able to rewrite.
 */

export type InvoiceActionState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function customerName(customer: Record<string, unknown> | null): string {
  if (!customer) return "";
  const company = text(customer.company_name).trim();
  if (company) return company;
  return [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ").trim();
}

export async function sendInvoice(
  _previousState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) return { error: "That invoice could not be found." };

  const channels: DeliveryChannel[] = [];
  if (formData.get("sendSms") === "on") channels.push("sms");
  if (formData.get("sendEmail") === "on") channels.push("email");

  if (channels.length === 0) {
    return { error: "Choose whether to send this by text, email, or both." };
  }

  const supabase = asFlexibleClient(await createClient());

  const { data } = await supabase
    .from("invoices")
    .select(
      `id, invoice_number, status, total_cents, balance_due_cents, due_at,
       stripe_hosted_invoice_url, organization_id,
       jobs ( customer_description, customers ( first_name, last_name, company_name, phone, email ) ),
       organizations ( name, phone, timezone )`,
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (!data) return { error: "That invoice could not be found." };

  const row = data as Record<string, unknown>;
  const job = (row.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;

  // The invoice total, which is what the business asked for. A partly-paid
  // invoice therefore still shows its full figure rather than the remainder —
  // the owner's call, so that the number in the message matches the number on
  // the invoice the customer is holding.
  const amountDue = Number(row.total_cents ?? 0) / 100;

  const permitted = invoiceCanBeSent({ status: text(row.status), amountDue });
  if (!permitted.ok) return { error: permitted.reason };

  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const dueAt = text(row.due_at);

  const attempts = await deliverInvoice({
    invoiceId: text(row.id),
    organizationId: text(row.organization_id),
    channels,
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
    facts: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      contactName: customerName(customer),
      invoiceNumber: `INV-${text(row.invoice_number) || String(row.invoice_number ?? "")}`,
      amountDue,
      dueLabel: dueAt
        ? new Intl.DateTimeFormat("en-US", {
            timeZone,
            month: "short",
            day: "numeric",
            year: "numeric",
          }).format(new Date(dueAt))
        : "",
      payUrl: text(row.stripe_hosted_invoice_url) || undefined,
      workSummary: text(job?.customer_description) || undefined,
    },
  });

  const outcome = describeDelivery(attempts);
  revalidatePath("/invoices");

  return outcome.ok ? { error: "", notice: outcome.message } : { error: outcome.message };
}
