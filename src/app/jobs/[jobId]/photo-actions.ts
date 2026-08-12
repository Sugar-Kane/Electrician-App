"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { DOCUMENTS_BUCKET, documentStoragePath, ensureDocumentsBucket } from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Photographing a job, before and after.
 *
 * The `documents` table has modelled this since the storage migration —
 * `job_id`, `photo_before`, `photo_after` — and nothing has ever written one.
 * A panel photo went into the phone's camera roll, where it is filed by date
 * next to somebody's dog and cannot be found when a customer disputes a bill
 * eight months later.
 *
 * The row is written through the caller's session so RLS applies, but the file
 * itself goes through the admin client: the storage policy needs the bucket to
 * exist, and only the service role can create it.
 */

export type PhotoActionState = { error: string; notice?: string };

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
]);

/** Ten megabytes. A modern phone photo is three, and HEIC is smaller still. */
const MAX_BYTES = 10 * 1024 * 1024;

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function callerContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data: authData } = await supabase.auth.getUser();
  const userId = authData.user?.id ?? "";
  if (!userId) return null;

  const { data } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId =
    typeof data?.organization_id === "string" ? data.organization_id : "";
  if (!organizationId) return null;

  return { supabase, organizationId, userId };
}

/**
 * The folder a job's documents belong in, made if it is not there.
 *
 * `documents.folder_id` is not null and restricts deletes, so nothing can be
 * filed without one. Most businesses have no folder rows at all — the files
 * page renders a blueprint client-side rather than writing them — so the first
 * photo on the first job is what actually creates one.
 */
type SessionClient = ReturnType<typeof asFlexibleClient>;

async function jobFolderId(
  supabase: SessionClient,
  organizationId: string,
  jobId: string,
  jobNumber: string,
): Promise<string | null> {
  const folderKey = `job/${jobId}`;

  const { data: existing } = await supabase
    .from("document_folders")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("folder_key", folderKey)
    .maybeSingle();

  const found = typeof existing?.id === "string" ? existing.id : "";
  if (found) return found;

  const { data: created, error } = await supabase
    .from("document_folders")
    .insert({
      organization_id: organizationId,
      folder_key: folderKey,
      display_name: `Job #${jobNumber}`,
      folder_type: "job",
      entity_id: jobId,
    })
    .select("id")
    .maybeSingle();

  // Two photos taken at once race here, and the loser hits the unique
  // constraint on (organization_id, folder_key). The folder it wanted now
  // exists, so read it back rather than failing an upload over a millisecond.
  if (error) {
    const { data: raced } = await supabase
      .from("document_folders")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("folder_key", folderKey)
      .maybeSingle();
    return typeof raced?.id === "string" ? raced.id : null;
  }

  return typeof created?.id === "string" ? created.id : null;
}

export async function uploadJobPhoto(
  _previous: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const jobNumber = text(formData, "jobNumber");
  const stage = text(formData, "stage") === "after" ? "after" : "before";

  const photo = formData.get("photo");
  if (!(photo instanceof File) || photo.size === 0) {
    return { error: "Choose a photo first." };
  }

  const extension = ALLOWED.get(photo.type);
  if (!extension) {
    return { error: "That file is not a photo. JPG, PNG, WebP and HEIC all work." };
  }
  if (photo.size > MAX_BYTES) {
    return { error: "That photo is over 10 MB. Most phones can be set to send a smaller one." };
  }

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return { error: "That job could not be found." };

  const { data: job } = await context.supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  const jobId = typeof job?.id === "string" ? job.id : "";
  if (!jobId) return { error: "That job could not be found." };

  const folderId = await jobFolderId(
    context.supabase,
    context.organizationId,
    jobId,
    jobNumber,
  );
  if (!folderId) return { error: "This job's folder could not be prepared." };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    await ensureDocumentsBucket();
    admin = getSupabaseAdmin();
  } catch {
    return { error: "Photo storage is not configured yet." };
  }

  const storagePath = documentStoragePath(
    context.organizationId,
    `jobs/${jobId}`,
    `${randomUUID()}.${extension}`,
  );

  const uploaded = await admin.storage
    .from(DOCUMENTS_BUCKET)
    .upload(storagePath, Buffer.from(await photo.arrayBuffer()), {
      contentType: photo.type,
      upsert: false,
    });

  if (uploaded.error) return { error: "That photo could not be uploaded." };

  const { error } = await context.supabase.from("documents").insert({
    organization_id: context.organizationId,
    folder_id: folderId,
    job_id: jobId,
    storage_path: storagePath,
    file_name: photo.name || `photo.${extension}`,
    display_name: stage === "after" ? "After" : "Before",
    document_type: stage === "after" ? "photo_after" : "photo_before",
    mime_type: photo.type,
    size_bytes: photo.size,
    // The insert policy requires this to be the caller, so a row written on
    // somebody else's behalf is rejected rather than silently misattributed.
    uploaded_by: context.userId,
  });

  if (error) {
    // The file is in the bucket and nothing points at it. Left alone it is a
    // stranded object nobody can find or delete through the app.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
    return { error: "That photo could not be attached to the job." };
  }

  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: stage === "after" ? "After photo added." : "Before photo added." };
}

export async function removeJobPhoto(
  _previous: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const jobNumber = text(formData, "jobNumber");
  const documentId = text(formData, "documentId");
  if (!documentId) return { error: "That photo could not be found." };

  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const { data: document } = await context.supabase
    .from("documents")
    .select("id, storage_path")
    .eq("organization_id", context.organizationId)
    .eq("id", documentId)
    .maybeSingle();

  const storagePath = typeof document?.storage_path === "string" ? document.storage_path : "";
  if (!storagePath) return { error: "That photo could not be found." };

  // Deleting a document is an owner-only policy. A DELETE that RLS forbids is
  // not an error — it succeeds and removes nothing — so the deleted rows are
  // asked for and counted. Without that, a technician tapping remove would get
  // "Removed." and watch the photo still be there after the refresh.
  const { data: deleted, error } = await context.supabase
    .from("documents")
    .delete()
    .eq("id", documentId)
    .eq("organization_id", context.organizationId)
    .select("id");

  if (error) return { error: "That photo could not be removed." };
  if (!deleted || deleted.length === 0) {
    return { error: "Only an owner can remove a photo once it is filed." };
  }

  try {
    await getSupabaseAdmin().storage.from(DOCUMENTS_BUCKET).remove([storagePath]);
  } catch {
    // The row is gone, which is what the screen reflects. A file left in the
    // bucket is wasted space, not a correctness problem worth failing over.
  }

  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: "Removed." };
}
