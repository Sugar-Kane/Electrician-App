"use server";

import { revalidatePath } from "next/cache";

import { recordActivity } from "@/lib/activity";
import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { deliverInvoice } from "@/lib/invoice-delivery";
import {
  describeDelivery,
  invoiceCanBeSent,
  type DeliveryChannel,
} from "@/lib/invoice-messages";
import { checkPayment } from "@/lib/invoice-payment";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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

type LoadedInvoice = {
  row: Record<string, unknown>;
  job: Record<string, unknown> | null;
  customer: Record<string, unknown> | null;
  facts: Parameters<typeof deliverInvoice>[0]["facts"];
};

/**
 * The invoice and what the customer is told about it, read through the
 * caller's session so RLS decides whether they may see it at all.
 */
async function loadInvoiceForCustomer(
  supabase: ReturnType<typeof asFlexibleClient>,
  invoiceId: string,
): Promise<LoadedInvoice | null> {
  const { data } = await supabase
    .from("invoices")
    .select(
      `id, invoice_number, status, total_cents, balance_due_cents, due_at, last_sent_at,
       stripe_hosted_invoice_url, organization_id, preview_token,
       jobs ( id, job_number, customer_id, customer_description, customers ( first_name, last_name, company_name, phone, email ) ),
       organizations ( name, phone, timezone )`,
    )
    .eq("id", invoiceId)
    .maybeSingle();

  if (!data) return null;

  const row = data as Record<string, unknown>;
  const job = (row.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;
  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const dueAt = text(row.due_at);
  const origin = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/+$/, "");
  const token = text(row.preview_token);

  return {
    row,
    job,
    customer,
    facts: {
      businessName: text(organization?.name) || "Your electrician",
      businessPhone: text(organization?.phone) || "our office",
      contactName: customerName(customer),
      invoiceNumber: `INV-${text(row.invoice_number) || String(row.invoice_number ?? "")}`,
      // The invoice total, which is what the business asked for. A partly-paid
      // invoice therefore still shows its full figure rather than the remainder —
      // the owner's call, so that the number in the message matches the number on
      // the invoice the customer is holding.
      amountDue: Number(row.total_cents ?? 0) / 100,
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
      viewUrl: origin && token ? `${origin}/invoice/${token}` : undefined,
    },
  };
}

function chosenChannels(formData: FormData): DeliveryChannel[] {
  const channels: DeliveryChannel[] = [];
  if (formData.get("sendSms") === "on") channels.push("sms");
  if (formData.get("sendEmail") === "on") channels.push("email");
  return channels;
}

export async function sendInvoice(
  _previousState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) return { error: "That invoice could not be found." };

  const channels = chosenChannels(formData);
  if (channels.length === 0) {
    return { error: "Choose whether to send this by text, email, or both." };
  }

  const supabase = asFlexibleClient(await createClient());
  const loaded = await loadInvoiceForCustomer(supabase, invoiceId);
  if (!loaded) return { error: "That invoice could not be found." };
  const { row, job, customer, facts } = loaded;

  const permitted = invoiceCanBeSent({ status: text(row.status), amountDue: facts.amountDue });
  if (!permitted.ok) return { error: permitted.reason };

  const attempts = await deliverInvoice({
    invoiceId: text(row.id),
    organizationId: text(row.organization_id),
    channels,
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
    customerId: text(job?.customer_id) || undefined,
    facts,
  });

  const outcome = describeDelivery(attempts);

  // Only when it actually went. An invoice that failed to send is not an
  // invoice the customer has, and a history saying otherwise is worse than no
  // history at all.
  const via = channels.map((channel) => (channel === "sms" ? "text" : channel)).join(" and ");
  if (outcome.ok) {
    await recordActivity(supabase, {
      organizationId: text(row.organization_id),
      eventType: "invoice.sent",
      label: "Invoice sent",
      jobId: text(job?.id) || null,
      metadata: {
        amount_cents: Number(row.total_cents) || 0,
        via,
        invoice_id: text(row.id),
      },
    });
  } else {
    // Written down as a failure, with why and where to try again, so the job
    // says the customer was not sent it rather than saying nothing at all.
    await recordActivity(supabase, {
      organizationId: text(row.organization_id),
      eventType: "invoice.send_failed",
      label: "Invoice not sent",
      jobId: text(job?.id) || null,
      metadata: {
        amount_cents: Number(row.total_cents) || 0,
        via,
        invoice_id: text(row.id),
        reason: outcome.message,
      },
    });
  }

  revalidatePath("/invoices");
  if (text(job?.job_number)) revalidatePath(`/jobs/${text(job?.job_number)}`);

  return outcome.ok ? { error: "", notice: outcome.message } : { error: outcome.message };
}

/**
 * A preview of a draft invoice, once the customer has signed: what they will
 * be billed, with nothing due yet. The invoice stays a draft (its lines can
 * still change) and is not marked sent; the final invoice goes when the work
 * is complete.
 */
export async function sendInvoicePreview(
  _previousState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) return { error: "That invoice could not be found." };

  const channels = chosenChannels(formData);
  if (channels.length === 0) {
    return { error: "Choose whether to send the preview by text, email, or both." };
  }

  const supabase = asFlexibleClient(await createClient());
  const loaded = await loadInvoiceForCustomer(supabase, invoiceId);
  if (!loaded) return { error: "That invoice could not be found." };
  const { row, job, customer, facts } = loaded;

  if (text(row.status) !== "draft" || text(row.last_sent_at)) {
    return { error: "This invoice has already gone to the customer, so there is nothing to preview." };
  }
  if (!(facts.amountDue > 0)) return { error: "This invoice has nothing on it to preview." };
  if (!facts.viewUrl) return { error: "This deployment has no public address, so no link can be sent." };

  const attempts = await deliverInvoice({
    invoiceId: text(row.id),
    organizationId: text(row.organization_id),
    channels,
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
    customerId: text(job?.customer_id) || undefined,
    facts,
    kind: "preview",
  });
  const outcome = describeDelivery(attempts, "Preview");

  await recordActivity(supabase, {
    organizationId: text(row.organization_id),
    eventType: outcome.ok ? "invoice.preview_sent" : "invoice.preview_failed",
    label: outcome.ok ? "Invoice preview sent" : "Invoice preview not sent",
    jobId: text(job?.id) || null,
    metadata: { amount_cents: Number(row.total_cents) || 0, invoice_id: text(row.id), ...(outcome.ok ? {} : { reason: outcome.message }) },
  });

  revalidatePath("/invoices");
  if (text(job?.job_number)) revalidatePath(`/jobs/${text(job?.job_number)}`);
  return outcome.ok ? { error: "", notice: outcome.message } : { error: outcome.message };
}

/**
 * A payment taken in hand: cash, a check, a card run outside the app. The
 * database function records it and moves the balance and status in one
 * transaction, and refuses anything this check would have.
 */
export async function recordInvoicePayment(
  _previousState: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) return { error: "That invoice could not be found." };

  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("invoices")
    .select("id, organization_id, status, total_cents, balance_due_cents, stripe_invoice_id, jobs ( id, job_number )")
    .eq("id", invoiceId)
    .maybeSingle();
  if (!data) return { error: "That invoice could not be found." };
  const row = data as Record<string, unknown>;
  const job = (row.jobs ?? null) as Record<string, unknown> | null;

  const check = checkPayment({
    invoice: {
      status: text(row.status),
      totalCents: Number(row.total_cents ?? 0),
      balanceDueCents: row.balance_due_cents === null || row.balance_due_cents === undefined ? null : Number(row.balance_due_cents),
      stripeInvoiceId: text(row.stripe_invoice_id) || null,
    },
    method: String(formData.get("method") ?? ""),
    amountText: String(formData.get("amount") ?? ""),
  });
  if (!check.ok) return { error: check.reason };

  const note = String(formData.get("note") ?? "").trim().slice(0, 500);
  const { error } = await supabase.rpc("record_invoice_payment", {
    p_invoice_id: invoiceId,
    p_method: check.method,
    p_amount_cents: check.amountCents,
    p_note: note || null,
  });
  if (error) {
    console.error("record invoice payment failed", { invoiceId, code: error.code, message: error.message });
    return { error: error.code === "22023" ? `Not recorded: ${error.message}.` : "The payment could not be recorded. Try again." };
  }

  await recordActivity(supabase, {
    organizationId: text(row.organization_id),
    eventType: check.status === "paid" ? "invoice.paid" : "invoice.partially_paid",
    label: check.status === "paid" ? "Invoice paid" : "Part payment recorded",
    jobId: text(job?.id) || null,
    metadata: { amount_cents: check.amountCents, method: check.method, invoice_id: invoiceId },
  });

  revalidatePath("/invoices");
  revalidatePath(`/invoices/${invoiceId}`);
  if (text(job?.job_number)) {
    revalidatePath(`/jobs/${text(job?.job_number)}`);
    revalidatePath("/jobs");
  }
  const dollars = (check.amountCents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });
  return {
    error: "",
    notice: check.status === "paid" ? `${dollars} recorded. The invoice is paid.` : `${dollars} recorded. Part of the invoice is still owed.`,
  };
}

/*
 * Deleting an invoice, and rebuilding the document one was generated into.
 *
 * Both arrived with the generated-PDF work. They sit beside `sendInvoice`
 * because they are the same object's lifecycle — made, looked at, sent, and
 * occasionally taken back — and splitting them across files would put three
 * different answers to "which client may touch an invoice" in three places.
 */

async function callerContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "";
  if (!userId) return null;

  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(data?.organization_id);
  if (!organizationId) return null;

  return { supabase, organizationId, userId };
}

/**
 * Delete an invoice and everything generated from it.
 *
 * The documents cascade in the database, so the rows go by themselves. The
 * files in the bucket do not — nothing cascades into object storage — so the
 * paths are read first and removed after, and a failure there is logged rather
 * than surfaced: the invoice is gone, which is what the screen reflects, and a
 * leftover object is wasted space rather than a wrong answer.
 */
export async function deleteInvoice(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) return { error: "That invoice could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const { data: invoice } = await context.supabase
    .from("invoices")
    .select("id, invoice_number, status, total_cents, balance_due_cents, paid_at, job_id")
    .eq("organization_id", context.organizationId)
    .eq("id", invoiceId)
    .maybeSingle();

  if (!invoice) return { error: "That invoice could not be found." };
  const row = invoice as Record<string, unknown>;

  // Money that has actually arrived is a record, not a draft. Deleting it would
  // lose the only trace of a payment and leave the books saying the customer
  // still owes nothing and was never billed.
  const paidCents = Number(row.total_cents ?? 0) - Number(row.balance_due_cents ?? 0);
  if (text(row.paid_at) || paidCents > 0) {
    return {
      error:
        "This invoice has money against it, so it cannot be deleted. Void it instead to keep the record.",
    };
  }

  // Read before deleting: after the cascade there is nothing left to say which
  // objects belonged to it.
  const { data: documents } = await context.supabase
    .from("documents")
    .select("storage_path")
    .eq("organization_id", context.organizationId)
    .eq("invoice_id", invoiceId);

  const paths = ((documents ?? []) as Record<string, unknown>[])
    .map((document) => text(document.storage_path))
    .filter(Boolean);

  const { data: deleted, error } = await context.supabase
    .from("invoices")
    .delete()
    .eq("id", invoiceId)
    .eq("organization_id", context.organizationId)
    .select("id");

  if (error) return { error: "That invoice could not be deleted." };
  // A DELETE that RLS forbids succeeds and removes nothing, so the rows are
  // counted rather than assumed. Without this somebody without permission gets
  // "Deleted." and watches the invoice still be there after a refresh.
  if (!deleted || deleted.length === 0) {
    return { error: "You do not have permission to delete this invoice." };
  }

  if (paths.length > 0) {
    try {
      await getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove(paths);
    } catch (storageError) {
      console.error("invoice: could not remove generated files", storageError);
    }
  }

  revalidatePath("/invoices");
  revalidatePath("/");
  if (text(row.job_id)) revalidatePath(`/jobs`);

  return { error: "", notice: `Invoice ${String(row.invoice_number ?? "")} deleted.` };
}

/**
 * Rebuild the PDF for an invoice.
 *
 * Wanted in two situations: the document failed to generate when the invoice
 * was raised, and the job has changed since. Both produce a new version rather
 * than overwriting, so what the customer was already sent stays readable.
 */
export async function regenerateInvoicePdf(
  _previous: InvoiceActionState,
  formData: FormData,
): Promise<InvoiceActionState> {
  const invoiceId = String(formData.get("invoiceId") ?? "").trim();
  if (!invoiceId) return { error: "That invoice could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const { data: organization } = await context.supabase
    .from("organizations")
    .select("timezone")
    .eq("id", context.organizationId)
    .maybeSingle();

  const { generateInvoicePdf } = await import("@/lib/pdf/invoice-data");

  const result = await generateInvoicePdf({
    database: context.supabase,
    organizationId: context.organizationId,
    invoiceId,
    timeZone: text(organization?.timezone) || "America/Los_Angeles",
    uploadedBy: context.userId,
  });

  if (result.error) return { error: result.error };

  revalidatePath(`/invoices/${invoiceId}`);
  revalidatePath("/invoices");

  return { error: "", notice: "Invoice rebuilt." };
}
