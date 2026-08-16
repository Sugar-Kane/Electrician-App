import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { renderToBuffer, type DocumentProps } from "@react-pdf/renderer";
import type { ReactElement } from "react";

import { DOCUMENTS_BUCKET, documentStoragePath, ensureDocumentsBucket } from "@/lib/document-storage";
import type { BusinessLetterhead } from "@/lib/pdf/letterhead";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Turning a document into a file, and keeping the file with its record.
 *
 * Generating is cheap and regenerating is the normal case: an invoice gets a
 * line added, a contract gets redrafted. So a new version supersedes rather
 * than overwrites — the old row is archived, the new one takes the next version
 * number, and the object it points at is left alone. A customer who was sent
 * version one can still be shown exactly what they were sent, which is the
 * whole reason a signed contract will fit here later without a rewrite.
 *
 * Rendering happens on the server for a reason beyond convenience: the figures
 * on an invoice must come from the same arithmetic the database has, and a
 * template that rendered in the browser could be handed anything.
 */

export type GeneratedDocument = {
  documentId: string;
  storagePath: string;
  versionNumber: number;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The business, as it appears at the top of everything it sends. */
export async function businessLetterhead(
  database: FlexibleSupabaseClient,
  organizationId: string,
): Promise<BusinessLetterhead> {
  const { data } = await database
    .from("organizations")
    .select(
      `name, phone, owner_notification_email, license_number,
       base_address_line_1, base_city, base_state, base_postal_code`,
    )
    .eq("id", organizationId)
    .maybeSingle();

  const row = (data ?? {}) as Record<string, unknown>;

  return {
    name: str(row.name) || "Your business",
    phone: str(row.phone),
    email: str(row.owner_notification_email),
    addressLine1: str(row.base_address_line_1),
    city: str(row.base_city),
    state: str(row.base_state),
    postalCode: str(row.base_postal_code),
    licenseNumber: str(row.license_number),
  };
}

/**
 * Render, store, and file a PDF against the record it came from.
 *
 * The write goes through the caller's session so RLS decides whether this
 * organization is theirs; only the upload uses the service role, and only for a
 * path this function built.
 */
export async function storeGeneratedPdf(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  jobId: string | null;
  folderId: string;
  /** Exactly one of these, which is what the document is *of*. */
  invoiceId?: string;
  contractId?: string;
  documentType: "invoice" | "contract";
  displayName: string;
  fileName: string;
  element: ReactElement<DocumentProps>;
  uploadedBy: string;
}): Promise<GeneratedDocument | { error: string }> {
  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    await ensureDocumentsBucket();
    admin = getSupabaseAdmin();
  } catch {
    return { error: "Document storage is not set up yet." };
  }

  let pdf: Buffer;
  try {
    pdf = await renderToBuffer(input.element);
  } catch (error) {
    console.error("pdf: could not render the document", error);
    return { error: "That document could not be produced. Try again." };
  }

  const owner = input.invoiceId
    ? { column: "invoice_id", id: input.invoiceId }
    : { column: "contract_id", id: input.contractId ?? "" };

  if (!owner.id) return { error: "That document has nothing to belong to." };

  // What is already on file for this record, so the new one supersedes it
  // rather than sitting alongside as a second current version.
  const { data: previous } = await input.database
    .from("documents")
    .select("id, version_number")
    .eq("organization_id", input.organizationId)
    .eq(owner.column, owner.id)
    .is("archived_at", null)
    .order("version_number", { ascending: false });

  const existing = (previous ?? []) as Record<string, unknown>[];
  const versionNumber = Number(existing[0]?.version_number ?? 0) + 1;

  const storagePath = documentStoragePath(
    input.organizationId,
    input.jobId ? `jobs/${input.jobId}` : "documents",
    `${randomUUID()}.pdf`,
  );

  const uploaded = await admin.storage.from(DOCUMENTS_BUCKET).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });

  if (uploaded.error) {
    console.error("pdf: could not upload", uploaded.error);
    return { error: "That document could not be saved. Try again." };
  }

  // Widened deliberately: the computed owner key narrows this to a
  // string-indexed literal, which the flexible client reads as a row shape it
  // has never heard of.
  const document: Record<string, unknown> = {
    organization_id: input.organizationId,
    folder_id: input.folderId,
    job_id: input.jobId,
    [owner.column]: owner.id,
    storage_path: storagePath,
    file_name: input.fileName,
    display_name: input.displayName,
    document_type: input.documentType,
    mime_type: "application/pdf",
    size_bytes: pdf.byteLength,
    checksum_sha256: createHash("sha256").update(pdf).digest("hex"),
    version_number: versionNumber,
    uploaded_by: input.uploadedBy,
  };

  const { data: created, error } = await input.database
    .from("documents")
    .insert(document)
    .select("id")
    .maybeSingle();

  if (error || !created) {
    // Nothing points at the object, so it would sit in the bucket forever.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    console.error("pdf: could not file the document row", error);
    return { error: "That document could not be filed. Try again." };
  }

  // Archived only once the replacement is safely on file, so a failure halfway
  // leaves the customer's current document intact rather than none at all.
  if (existing.length > 0) {
    await input.database
      .from("documents")
      .update({ archived_at: new Date().toISOString() })
      .in("id", existing.map((previousRow) => str(previousRow.id)))
      .eq("organization_id", input.organizationId);
  }

  return {
    documentId: str(created.id),
    storagePath,
    versionNumber,
  };
}

export type StoredDocument = {
  documentId: string;
  url: string;
  fileName: string;
  versionNumber: number;
  generatedLabel: string;
};

/** An hour is longer than anybody spends reading one and short enough to leak little. */
const SIGNED_URL_SECONDS = 3600;

/**
 * The current PDFs for several records at once, keyed by the record's id.
 *
 * The single version signs one URL per call, which is a round trip to storage
 * each; a job with a handful of contract drafts on it would make that many
 * before the page could render. This reads the rows in one query and signs them
 * in one batch.
 *
 * Records with no document are simply absent from the map, which is an ordinary
 * state rather than an error.
 */
export async function currentDocuments(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  column: "invoice_id" | "contract_id";
  ids: string[];
  timeZone: string;
}): Promise<Map<string, StoredDocument>> {
  const found = new Map<string, StoredDocument>();
  const ids = input.ids.filter(Boolean);
  if (ids.length === 0) return found;

  const { data } = await input.database
    .from("documents")
    .select(`id, ${input.column}, storage_path, file_name, version_number, created_at`)
    .eq("organization_id", input.organizationId)
    .in(input.column, ids)
    .is("archived_at", null)
    .order("version_number", { ascending: false });

  const rows = (data ?? []) as Record<string, unknown>[];

  // Ordered newest version first, so the first row seen for a record is the one
  // that counts and the rest are superseded versions still on file.
  const newest = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    const owner = str(row[input.column]);
    if (owner && !newest.has(owner)) newest.set(owner, row);
  }
  if (newest.size === 0) return found;

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return found;
  }

  const paths = [...newest.values()].map((row) => str(row.storage_path));
  const signed = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrls(paths, SIGNED_URL_SECONDS);
  if (signed.error || !signed.data) return found;

  const urls = new Map(
    signed.data
      .filter((entry) => entry.signedUrl)
      // `path` comes back as the path that was asked for, which is how a
      // partially failed batch is matched up rather than assumed to be in order.
      .map((entry) => [str(entry.path), entry.signedUrl]),
  );

  for (const [owner, row] of newest) {
    const url = urls.get(str(row.storage_path));
    if (!url) continue;

    const createdAt = str(row.created_at);
    found.set(owner, {
      documentId: str(row.id),
      url,
      fileName: str(row.file_name) || "document.pdf",
      versionNumber: Number(row.version_number ?? 1),
      generatedLabel: createdAt
        ? new Intl.DateTimeFormat("en-US", {
            timeZone: input.timeZone,
            month: "short",
            day: "numeric",
            hour: "numeric",
            minute: "2-digit",
          }).format(new Date(createdAt))
        : "",
    });
  }

  return found;
}

/**
 * The current PDF for a record, with a URL that works for an hour.
 *
 * Null when there is not one yet, which is an ordinary state: an invoice raised
 * before this existed has no document until somebody regenerates it.
 */
export async function currentDocument(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  invoiceId?: string;
  contractId?: string;
  timeZone: string;
}): Promise<StoredDocument | null> {
  const column = input.invoiceId ? "invoice_id" : "contract_id";
  const id = input.invoiceId ?? input.contractId ?? "";
  if (!id) return null;

  const { data } = await input.database
    .from("documents")
    .select("id, storage_path, file_name, version_number, created_at")
    .eq("organization_id", input.organizationId)
    .eq(column, id)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return null;
  }

  const signed = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrl(str(row.storage_path), SIGNED_URL_SECONDS);

  if (signed.error || !signed.data?.signedUrl) return null;

  const createdAt = str(row.created_at);

  return {
    documentId: str(row.id),
    url: signed.data.signedUrl,
    fileName: str(row.file_name) || "document.pdf",
    versionNumber: Number(row.version_number ?? 1),
    generatedLabel: createdAt
      ? new Intl.DateTimeFormat("en-US", {
          timeZone: input.timeZone,
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        }).format(new Date(createdAt))
      : "",
  };
}
