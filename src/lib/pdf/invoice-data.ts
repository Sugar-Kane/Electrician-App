import "server-only";

import { InvoiceDocument, invoiceFileName } from "@/lib/pdf/invoice-document";
import { businessLetterhead, storeGeneratedPdf } from "@/lib/pdf/store";
import { formatCents, formatQuantity } from "@/lib/job-lines";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Everything an invoice PDF needs, gathered from the records it bills.
 *
 * Kept apart from the template, which knows how a document looks and nothing
 * about the database, and apart from the action, which knows when to make one.
 * The figures are read back from the invoice row rather than recalculated here:
 * `invoice-math` worked them out when the invoice was raised, and a second
 * calculation is a second answer waiting to disagree with the first.
 */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

function dateLabel(iso: unknown, timeZone: string): string {
  const value = str(iso);
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(at);
}

const STATUS_WORDS: Record<string, string> = {
  draft: "Draft",
  sent: "Unpaid",
  partially_paid: "Part paid",
  paid: "Paid",
  overdue: "Overdue",
  void: "Void",
};

/**
 * Build and file the PDF for an invoice that already exists.
 *
 * Returns the error rather than throwing: a document that could not be produced
 * must not undo the invoice, which is a real record of money owed whether or
 * not there is a nice copy of it to send.
 */
export async function generateInvoicePdf(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  invoiceId: string;
  timeZone: string;
  uploadedBy: string;
}): Promise<{ error: string } | { error: "" }> {
  const { data } = await input.database
    .from("invoices")
    .select(
      `id, invoice_number, status, subtotal_cents, diagnostic_credit_cents, tax_cents,
       total_cents, balance_due_cents, due_at, created_at,
       jobs (
         id, job_number, scheduled_start, technician_notes,
         customers ( first_name, last_name, company_name, phone, email ),
         properties ( address_line_1, address_line_2, city, state, postal_code ),
         technicians ( display_name )
       )`,
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.invoiceId)
    .maybeSingle();

  if (!data) return { error: "That invoice could not be found." };

  const invoice = data as Record<string, unknown>;
  const job = (invoice.jobs ?? null) as Record<string, unknown> | null;
  const customer = (job?.customers ?? null) as Record<string, unknown> | null;
  const property = (job?.properties ?? null) as Record<string, unknown> | null;
  const technician = (job?.technicians ?? null) as Record<string, unknown> | null;

  const jobId = str(job?.id);

  const [{ data: lineRows }, business, { data: organization }] = await Promise.all([
    jobId
      ? input.database
          .from("job_line_items")
          .select("kind, description, quantity, unit, unit_price_cents")
          .eq("organization_id", input.organizationId)
          .eq("job_id", jobId)
          .order("created_at", { ascending: true })
      : Promise.resolve({ data: [] as Record<string, unknown>[] }),
    businessLetterhead(input.database, input.organizationId),
    input.database
      .from("organizations")
      .select("payment_terms")
      .eq("id", input.organizationId)
      .maybeSingle(),
  ]);

  const addressLines = [
    str(property?.address_line_1),
    str(property?.address_line_2),
    [
      [str(property?.city), str(property?.state)].filter(Boolean).join(", "),
      str(property?.postal_code),
    ]
      .filter(Boolean)
      .join(" "),
  ].filter((line) => line.trim() !== "");

  const customerName =
    str(customer?.company_name) ||
    [str(customer?.first_name), str(customer?.last_name)].filter(Boolean).join(" ") ||
    "Customer";

  const lines = ((lineRows ?? []) as Record<string, unknown>[]).map((row) => {
    // numeric arrives as a string over PostgREST, so this would concatenate
    // rather than multiply if it were passed through untouched.
    const quantity = num(row.quantity);
    const unitPriceCents = num(row.unit_price_cents);

    return {
      description: str(row.description),
      quantityLabel: `${formatQuantity(quantity)} ${str(row.unit) || "each"}`,
      rateLabel: formatCents(unitPriceCents),
      amountLabel: formatCents(Math.round(quantity * unitPriceCents)),
    };
  });

  const totalCents = num(invoice.total_cents);
  const balanceCents = num(invoice.balance_due_cents);
  const creditCents = num(invoice.diagnostic_credit_cents);
  const taxCents = num(invoice.tax_cents);
  // What the customer has already handed over. Derived rather than stored:
  // the difference between the total and what is still owed is the payment,
  // however it arrived.
  const paidCents = Math.max(0, totalCents - balanceCents);

  const invoiceNumber = String(invoice.invoice_number ?? "");

  return storeGeneratedPdf({
    database: input.database,
    organizationId: input.organizationId,
    jobId: jobId || null,
    folderId: await invoiceFolderId(input.database, input.organizationId, jobId, str(job?.job_number)),
    invoiceId: input.invoiceId,
    documentType: "invoice",
    displayName: `Invoice ${invoiceNumber}`,
    fileName: invoiceFileName(invoiceNumber, business.name),
    uploadedBy: input.uploadedBy,
    element: InvoiceDocument({
      data: {
        business,
        invoiceNumber,
        issuedLabel: dateLabel(invoice.created_at, input.timeZone),
        dueLabel: dateLabel(invoice.due_at, input.timeZone) || "On receipt",
        statusLabel: STATUS_WORDS[str(invoice.status)] ?? "Unpaid",
        customer: {
          name: customerName,
          addressLines,
          phone: str(customer?.phone),
          email: str(customer?.email),
        },
        job: {
          number: String(job?.job_number ?? ""),
          addressLines,
          serviceDateLabel: dateLabel(job?.scheduled_start, input.timeZone),
          technician: str(technician?.display_name),
        },
        lines,
        totals: {
          subtotalLabel: formatCents(num(invoice.subtotal_cents)),
          diagnosticCreditLabel: creditCents > 0 ? `-${formatCents(creditCents)}` : "",
          taxLabel: taxCents > 0 ? formatCents(taxCents) : "",
          totalLabel: formatCents(totalCents),
          paidLabel: paidCents > 0 ? formatCents(paidCents) : "",
          balanceLabel: formatCents(balanceCents),
        },
        paymentTerms:
          str((organization as Record<string, unknown> | null)?.payment_terms) ||
          "Payment is due on receipt.",
        // The technician's notes are deliberately not here. They are written
        // "never shown to the customer" and this is the document the customer
        // receives.
        customerNote: "",
      },
    }),
  }).then((result) => ("error" in result ? { error: result.error } : { error: "" as const }));
}

/**
 * Where a job's paperwork is filed, made if it is not there.
 *
 * `documents.folder_id` is not null, so nothing can be stored without one, and
 * most businesses have no folder rows at all until their first upload.
 */
async function invoiceFolderId(
  database: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
  jobNumber: string,
): Promise<string> {
  const folderKey = jobId ? `job/${jobId}` : "invoices";

  const { data: existing } = await database
    .from("document_folders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("folder_key", folderKey)
    .maybeSingle();

  const found = str(existing?.id);
  if (found) return found;

  const { data: created } = await database
    .from("document_folders")
    .insert({
      organization_id: organizationId,
      folder_key: folderKey,
      display_name: jobId ? `Job #${jobNumber}` : "Invoices",
      folder_type: jobId ? "job" : "system",
      entity_id: jobId || null,
    })
    .select("id")
    .maybeSingle();

  const madeId = str(created?.id);
  if (madeId) return madeId;

  // Lost a race against another upload; the folder it wanted now exists.
  const { data: raced } = await database
    .from("document_folders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("folder_key", folderKey)
    .maybeSingle();

  return str(raced?.id);
}
