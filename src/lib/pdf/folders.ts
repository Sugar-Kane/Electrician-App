import "server-only";

import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Where a job's paperwork is filed, made if it is not there.
 *
 * `documents.folder_id` is not null, so nothing can be stored without one, and
 * most businesses have no folder rows at all until their first upload. Shared by
 * every kind of generated document deliberately: an invoice and the contract it
 * bills against belong in the same folder, and a customer looking for "the
 * paperwork for the panel job" is looking for one place, not two.
 */

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  const folderKey = input.jobId ? `job/${input.jobId}` : input.fallbackKey;

  const { data: existing } = await input.database
    .from("document_folders")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("folder_key", folderKey)
    .maybeSingle();

  const found = str(existing?.id);
  if (found) return found;

  const { data: created } = await input.database
    .from("document_folders")
    .insert({
      organization_id: input.organizationId,
      folder_key: folderKey,
      display_name: input.jobId ? `Job #${input.jobNumber}` : input.fallbackName,
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
