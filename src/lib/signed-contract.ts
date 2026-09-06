import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { recordActivity } from "@/lib/activity";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  ensureDocumentsBucket,
} from "@/lib/document-storage";
import { downloadDocumensoItem, getDocumensoEnvelope } from "@/lib/documenso";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const MAX_SIGNED_PDF_BYTES = 50 * 1024 * 1024;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function signedFileName(fileName: string): string {
  const safe = fileName.trim() || "contract.pdf";
  return safe.toLowerCase().endsWith(".pdf")
    ? `${safe.slice(0, -4)}-signed.pdf`
    : `${safe}-signed.pdf`;
}

function validInstant(value: string): string {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : "";
}

function laterInstant(left: string, right: string): string {
  const leftMillis = Date.parse(left);
  const rightMillis = Date.parse(right);
  if (!Number.isFinite(leftMillis)) return right;
  if (!Number.isFinite(rightMillis)) return left;
  return leftMillis >= rightMillis
    ? new Date(leftMillis).toISOString()
    : new Date(rightMillis).toISOString();
}

async function finalizeSignedContract(input: {
  contractId: string;
  documentId: string;
  organizationId: string;
  signedAt: string;
  lastEventAt: string;
}): Promise<boolean> {
  const admin = asFlexibleClient(getSupabaseAdmin());
  const { data, error } = await admin.rpc("finalize_signed_contract_document", {
    p_contract_id: input.contractId,
    p_document_id: input.documentId,
    p_organization_id: input.organizationId,
    p_signed_at: input.signedAt,
    p_last_event_at: input.lastEventAt,
  });
  if (error || data !== true) {
    console.error("documenso: signed contract could not be finalized", error);
    return false;
  }
  return true;
}

/**
 * Copy Documenso's sealed PDF into the same private job folder as the draft.
 *
 * The provider reference is unique on `documents`, so webhook retries and a
 * manual "check status" click converge on one signed version.  The unsigned
 * file is archived only after the sealed one is safely uploaded and filed.
 */
export async function fileSignedContract(input: {
  envelopeId: string;
  completedAt?: string;
  actorUserId?: string | null;
}): Promise<
  | { ok: true; contractId: string; jobId: string; alreadyFiled: boolean }
  | { ok: false; error: string }
> {
  const admin = asFlexibleClient(getSupabaseAdmin());
  const { data: contractData } = await admin
    .from("contracts")
    .select("id, organization_id, job_id, signed_at, signature_last_event_at")
    .eq("signature_provider", "documenso")
    .eq("signature_envelope_id", input.envelopeId)
    .maybeSingle();

  if (!contractData) return { ok: false, error: "That signature request is not linked to a contract." };
  const contract = contractData as Record<string, unknown>;
  const contractId = text(contract.id);
  const organizationId = text(contract.organization_id);
  const jobId = text(contract.job_id);

  const { data: already } = await admin
    .from("documents")
    .select("id")
    .eq("signature_provider", "documenso")
    .eq("signature_envelope_id", input.envelopeId)
    .maybeSingle();

  if (already) {
    const signedAt = validInstant(text(contract.signed_at)) ||
      validInstant(input.completedAt ?? "") ||
      new Date().toISOString();
    const finalized = await finalizeSignedContract({
      contractId,
      documentId: text(already.id),
      organizationId,
      signedAt,
      lastEventAt: laterInstant(text(contract.signature_last_event_at), signedAt),
    });
    if (!finalized) {
      return { ok: false, error: "The signed PDF is saved, but its status could not be reconciled." };
    }
    return { ok: true, contractId, jobId, alreadyFiled: true };
  }

  const envelope = await getDocumensoEnvelope(input.envelopeId);
  if (envelope.status !== "COMPLETED") {
    return { ok: false, error: "The contract is still waiting for signatures." };
  }
  const itemId = envelope.itemIds[0];
  if (!itemId) return { ok: false, error: "The signing service has no completed PDF yet." };

  const pdf = await downloadDocumensoItem(itemId);
  if (pdf.length < 5 || pdf.subarray(0, 5).toString("ascii") !== "%PDF-") {
    return { ok: false, error: "The signing service returned an invalid PDF." };
  }
  if (pdf.length > MAX_SIGNED_PDF_BYTES) {
    return { ok: false, error: "The signed PDF is too large to save." };
  }

  const { data: current } = await admin
    .from("documents")
    .select(
      `id, folder_id, job_id, file_name, display_name, version_number,
       uploaded_by, source_snapshot`,
    )
    .eq("organization_id", organizationId)
    .eq("contract_id", contractId)
    .is("archived_at", null)
    .order("version_number", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!current) return { ok: false, error: "The original contract PDF is missing." };
  const draft = current as Record<string, unknown>;

  await ensureDocumentsBucket();
  const fileName = signedFileName(text(draft.file_name));
  const storagePath = documentStoragePath(
    organizationId,
    jobId ? `jobs/${jobId}` : "documents",
    `${randomUUID()}.pdf`,
  );
  const uploaded = await getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET).upload(storagePath, pdf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (uploaded.error) return { ok: false, error: "The signed PDF could not be saved." };

  const { data: created, error: insertError } = await admin
    .from("documents")
    .insert({
      organization_id: organizationId,
      folder_id: text(draft.folder_id),
      job_id: jobId || null,
      contract_id: contractId,
      storage_path: storagePath,
      file_name: fileName,
      display_name: `${text(draft.display_name) || "Contract"} — signed`,
      document_type: "contract",
      mime_type: "application/pdf",
      size_bytes: pdf.byteLength,
      checksum_sha256: createHash("sha256").update(pdf).digest("hex"),
      source: "app",
      version_number: Number(draft.version_number ?? 1) + 1,
      uploaded_by: input.actorUserId || text(draft.uploaded_by) || null,
      source_snapshot: draft.source_snapshot ?? null,
      signature_provider: "documenso",
      signature_envelope_id: input.envelopeId,
    })
    .select("id")
    .maybeSingle();

  if (insertError || !created) {
    await getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove([storagePath]);

    // Another delivery of the same event may have won the unique constraint.
    const { data: wonElsewhere } = await admin
      .from("documents")
      .select("id")
      .eq("signature_provider", "documenso")
      .eq("signature_envelope_id", input.envelopeId)
      .maybeSingle();
    if (wonElsewhere) {
      const signedAt = validInstant(text(contract.signed_at)) ||
        validInstant(input.completedAt ?? "") ||
        validInstant(envelope.completedAt) ||
        new Date().toISOString();
      const finalized = await finalizeSignedContract({
        contractId,
        documentId: text(wonElsewhere.id),
        organizationId,
        signedAt,
        lastEventAt: laterInstant(text(contract.signature_last_event_at), signedAt),
      });
      if (!finalized) {
        return { ok: false, error: "The signed PDF is saved, but its status could not be reconciled." };
      }
      return { ok: true, contractId, jobId, alreadyFiled: true };
    }
    return { ok: false, error: "The signed PDF could not be filed." };
  }

  const signedAt = validInstant(input.completedAt ?? "") ||
    validInstant(envelope.completedAt) ||
    new Date().toISOString();
  const finalized = await finalizeSignedContract({
    contractId,
    documentId: text(created.id),
    organizationId,
    signedAt,
    lastEventAt: laterInstant(text(contract.signature_last_event_at), signedAt),
  });
  if (!finalized) {
    const { error: deleteError } = await admin
      .from("documents")
      .delete()
      .eq("id", text(created.id))
      .eq("organization_id", organizationId);
    if (!deleteError) {
      await getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    } else {
      // Keep a recoverable database pointer if deletion itself failed, but make
      // sure the incomplete replacement is never chosen as the current PDF.
      await admin
        .from("documents")
        .update({ archived_at: new Date().toISOString() })
        .eq("id", text(created.id))
        .eq("organization_id", organizationId);
    }
    return { ok: false, error: "The signed PDF could not replace the current contract safely." };
  }

  await recordActivity(admin, {
    organizationId,
    jobId: jobId || null,
    actorUserId: input.actorUserId ?? null,
    eventType: "contract.signed",
    label: "Contract signed",
  });

  return { ok: true, contractId, jobId, alreadyFiled: false };
}
