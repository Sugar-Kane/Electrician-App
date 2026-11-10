import "server-only";

import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/**
 * The invoice PDF itself, as bytes: for the customer's download from their
 * invoice link, and for attaching to the invoice email.
 *
 * The newest generated version is used. An invoice that has none yet (raised
 * before documents existed, or whose PDF failed to build) gets one built now,
 * so the customer is never left without it.
 */

export type InvoicePdf = { bytes: Uint8Array; fileName: string };

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function newestDocument(organizationId: string, invoiceId: string): Promise<Row | null> {
  const { data } = await getSupabaseAdmin()
    .from("documents")
    .select("storage_path, file_name, version_number")
    .eq("organization_id", organizationId)
    .eq("invoice_id", invoiceId)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** The PDF of one invoice of one business, building it first if it has none. */
export async function invoicePdf(organizationId: string, invoiceId: string): Promise<InvoicePdf | null> {
  const admin = getSupabaseAdmin();
  let document = await newestDocument(organizationId, invoiceId);
  if (!document) {
    const { data: organization } = await admin.from("organizations").select("timezone").eq("id", organizationId).maybeSingle();
    const { generateInvoicePdf } = await import("@/lib/pdf/invoice-data");
    const built = await generateInvoicePdf({
      database: asFlexibleClient(admin),
      organizationId,
      invoiceId,
      timeZone: text((organization as Row | null)?.timezone) || "America/Los_Angeles",
      uploadedBy: "",
    });
    if (built.error) return null;
    document = await newestDocument(organizationId, invoiceId);
    if (!document) return null;
  }
  const { data: file, error } = await admin.storage.from(DOCUMENTS_BUCKET).download(text(document.storage_path));
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
