import "server-only";

import { DOCUMENTS_BUCKET } from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { currentContext } from "@/lib/request-context";

/**
 * A job's photos, with URLs that work for an hour.
 *
 * The bucket is private, so there is no permanent address to render. Signing
 * happens per request through the service role; the alternative — a public
 * bucket — would put every customer's panel photo behind a guessable uuid and
 * nothing else.
 */

export type JobPhoto = {
  id: string;
  stage: "before" | "after";
  url: string;
  fileName: string;
};

/** An hour is longer than anybody spends on one job page and short enough to leak little. */
const SIGNED_URL_SECONDS = 3600;

export async function getJobPhotos(jobNumber: string): Promise<JobPhoto[]> {
  const context = await currentContext();
  if (!context) return [];

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return [];

  const supabase = asFlexibleClient(await createClient());

  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  const jobId = typeof job?.id === "string" ? job.id : "";
  if (!jobId) return [];

  // Read through the caller's session, so RLS decides what is theirs to see.
  // Only the signing below uses the service role, and only for paths this query
  // already returned.
  const { data, error } = await supabase
    .from("documents")
    .select("id, storage_path, file_name, document_type")
    .eq("organization_id", context.organizationId)
    .eq("job_id", jobId)
    .in("document_type", ["photo_before", "photo_after"])
    .order("created_at", { ascending: true });

  if (error || !data || data.length === 0) return [];

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return [];
  }

  const paths = data.map((row: Record<string, unknown>) => String(row.storage_path ?? ""));
  const { data: signed } = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .createSignedUrls(paths, SIGNED_URL_SECONDS);

  const urlByPath = new Map<string, string>();
  for (const entry of signed ?? []) {
    if (entry.path && entry.signedUrl) urlByPath.set(entry.path, entry.signedUrl);
  }

  return data
    .map((row: Record<string, unknown>) => ({
      id: String(row.id ?? ""),
      stage: row.document_type === "photo_after" ? ("after" as const) : ("before" as const),
      url: urlByPath.get(String(row.storage_path ?? "")) ?? "",
      fileName: String(row.file_name ?? "Photo"),
    }))
    // A row whose file could not be signed is a broken image box. Dropping it
    // is quieter and no less honest than rendering one.
    .filter((photo) => photo.url !== "");
}
