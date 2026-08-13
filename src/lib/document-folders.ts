import "server-only";

import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * The folder a job's paperwork belongs in.
 *
 * Almost always a lookup rather than a write. A database trigger
 * (`private.sync_job_document_folder`) files every job under Jobs → year →
 * month the moment it is created, keyed `job:<uuid>` and named the way the
 * files page expects — "JOB-9 – Adam – 994 Red Gum Lane – Diagnostic" — and
 * keeps that name in step when the job changes.
 *
 * Writing our own `job/<uuid>` alongside it, which is what this did, gave every
 * job two folders: the real one in the tree, and a nameless orphan holding the
 * generated files, parented nowhere and reachable from nothing. The convention
 * is the trigger's, and this follows it.
 *
 * Shared by every kind of generated document deliberately: an invoice and the
 * contract it bills against belong in the same folder, because somebody looking
 * for "the paperwork for the panel job" is looking for one place.
 */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The trigger's key for a job's folder. Must match it exactly. */
export function jobFolderKey(jobId: string): string {
  return `job:${jobId}`;
}

export async function documentFolderId(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  jobId: string;
  jobNumber: string;
  /** Where documents with no job go — "Invoices", "Contracts". */
  fallbackKey: string;
  fallbackName: string;
}): Promise<string> {
  const folderKey = input.jobId ? jobFolderKey(input.jobId) : input.fallbackKey;

  const { data: existing } = await input.database
    .from("document_folders")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("folder_key", folderKey)
    .maybeSingle();

  const found = str(existing?.id);
  if (found) return found;

  /*
   * Only reached for a job the trigger never saw, or for the no-job fallback.
   *
   * The name follows the trigger's vocabulary rather than inventing a second
   * one, and no parent is guessed — the trigger reparents and renames it on the
   * next change to the job, and a folder in the wrong place beats a document
   * that cannot be filed at all.
   */
  const { data: created } = await input.database
    .from("document_folders")
    .insert({
      organization_id: input.organizationId,
      folder_key: folderKey,
      display_name: input.jobId
        ? `JOB-${input.jobNumber || "?"}`
        : input.fallbackName,
      folder_type: input.jobId ? "job" : "system",
      entity_id: input.jobId || null,
    })
    .select("id")
    .maybeSingle();

  const madeId = str(created?.id);
  if (madeId) return madeId;

  // Lost a race against another upload; the folder it wanted now exists.
  const { data: raced } = await input.database
    .from("document_folders")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("folder_key", folderKey)
    .maybeSingle();

  return str(raced?.id);
}
