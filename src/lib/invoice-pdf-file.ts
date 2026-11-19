import "server-only";

import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { isOwnedObjectPath, reportRefusedPaths } from "@/lib/tenant-storage-path";

/**
 * The invoice PDF itself, as bytes: for the customer's download from their
 * invoice link, and for attaching to the invoice email.
 *
 * The newest generated version is used. An invoice that has none yet (raised
 * before documents existed, or whose PDF failed to build) gets one built now,
 * so the customer is never left without it. So does one that changed after its
 * PDF was built: a payment recorded in cash, by check or through Stripe marks
 * the invoice paid, and a PDF still saying "Draft, $332.00 due" beside a
 * "Paid, thank you" page is the one document the customer keeps.
 */

export type InvoicePdf = { bytes: Uint8Array; fileName: string };

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function newestDocument(organizationId: string, invoiceId: string): Promise<Row | null> {
  const { data } = await getSupabaseAdmin()
    .from("documents")
    .select("storage_path, file_name, version_number, created_at")
    .eq("organization_id", organizationId)
    .eq("invoice_id", invoiceId)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/**
 * Make sure the invoice's newest PDF says what the invoice says now: built when
 * there is none, or when the invoice changed after it was built (paid, refunded,
 * discounted). Returns the newest document row, or null when none could be made.
 */
export async function freshInvoiceDocument(organizationId: string, invoiceId: string): Promise<Row | null> {
  const admin = getSupabaseAdmin();
  let document = await newestDocument(organizationId, invoiceId);
  if (document) {
    const { data: invoice } = await admin
      .from("invoices")
      .select("updated_at")
      .eq("organization_id", organizationId)
      .eq("id", invoiceId)
      .maybeSingle();
    const changed = Date.parse(text((invoice as Row | null)?.updated_at));
    const built = Date.parse(text(document.created_at));
    if (Number.isFinite(changed) && Number.isFinite(built) && changed > built) document = null;
  }
  if (document) return document;
  const { data: organization } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
  const { generateInvoicePdf } = await import("@/lib/pdf/invoice-data");
  await generateInvoicePdf({
    database: asFlexibleClient(admin),
    organizationId,
    invoiceId,
    timeZone: text((organization as Row | null)?.timezone) || "America/Los_Angeles",
    uploadedBy: "",
  });
  // If the build failed, the older version is still better than nothing.
  return newestDocument(organizationId, invoiceId);
}

/** The PDF of one invoice of one business, built first if it has none or is out of date. */
export async function invoicePdf(organizationId: string, invoiceId: string): Promise<InvoicePdf | null> {
  const admin = getSupabaseAdmin();
  const document = await freshInvoiceDocument(organizationId, invoiceId);
  if (!document) return null;
  // Downloaded with the service role and attached to an email: only a file
  // under this business's own prefix.
  if (!isOwnedObjectPath(document.storage_path, organizationId, { minSegments: 3 })) {
    reportRefusedPaths("invoice PDF", 1);
    return null;
  }
  const { data: file, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(document.storage_path);
  if (error || !file) return null;
  return { bytes: new Uint8Array(await file.arrayBuffer()), fileName: text(document.file_name) || "invoice.pdf" };
}

/**
 * The PDF behind a customer's invoice link. The link's token is the only key:
 * it is the same secret the invoice page already trusts. A void invoice has
 * no PDF to give.
 */
export async function invoicePdfForLink(token: string): Promise<InvoicePdf | null> {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const { data } = await getSupabaseAdmin().from("invoices").select("id, organization_id, status").eq("preview_token", token).maybeSingle();
  const row = data as Row | null;
  if (!row || text(row.status) === "void") return null;
  return invoicePdf(text(row.organization_id), text(row.id));
}
