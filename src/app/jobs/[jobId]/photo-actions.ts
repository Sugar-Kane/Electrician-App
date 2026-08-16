"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { DOCUMENTS_BUCKET, documentStoragePath, ensureDocumentsBucket } from "@/lib/document-storage";
import { jobFolderKey } from "@/lib/document-folders";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Photographing a job, before and after.
 *
 * The photo never travels through this server, and that is the whole point of
 * the rewrite. It used to: the file was posted to a Server Action, which read it
 * into a Buffer and forwarded it to storage. Server Actions are capped at 1MB of
 * request body by default, a phone photo is three to five, and the framework
 * rejects the request before the action runs — so every careful error message
 * below was unreachable and the technician got a bare "This page couldn't load"
 * instead. Raising the cap only moves the wall: Vercel refuses request bodies
 * over about 4.5MB whatever Next is configured to allow, so a modern phone
 * camera would still have failed.
 *
 * Now the browser uploads straight to Supabase Storage and the server does the
 * two things only it can do: decide where the file is allowed to go, and write
 * the row that points at it.
 *
 * The client never chooses the path. `createJobPhotoUpload` builds it, signs a
 * token that is only valid for that exact object, and `recordJobPhoto` refuses
 * anything that did not land where it was sent — otherwise a crafted call could
 * file somebody else's object against this job.
 */

export type PhotoActionState = { error: string; notice?: string };

export type PhotoUploadTicket =
  | { ok: true; path: string; token: string; bucket: string }
  | { ok: false; error: string };

const ALLOWED = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
  ["image/heic", "heic"],
  ["image/heif", "heic"],
]);

const BY_EXTENSION = new Map([
  ["jpg", "image/jpeg"],
  ["jpeg", "image/jpeg"],
  ["png", "image/png"],
  ["webp", "image/webp"],
  ["heic", "image/heic"],
  ["heif", "image/heif"],
]);

/** Twenty megabytes. A 48-megapixel phone photo is about twelve. */
const MAX_BYTES = 20 * 1024 * 1024;

/**
 * What kind of photo this is, believing the file name when the browser will not
 * say.
 *
 * Several Android browsers report an empty `type` for a camera capture, and
 * some report `application/octet-stream`. Rejecting those means the camera
 * button does nothing on those phones, with a message about file types that
 * blames the electrician for their browser.
 */
function photoKind(mimeType: string, fileName: string): { mimeType: string; extension: string } | null {
  const declared = ALLOWED.get(mimeType.trim().toLowerCase());
  if (declared) return { mimeType: mimeType.trim().toLowerCase(), extension: declared };

  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const guessed = BY_EXTENSION.get(extension);
  if (guessed) return { mimeType: guessed, extension: ALLOWED.get(guessed)! };

  return null;
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

type SessionClient = ReturnType<typeof asFlexibleClient>;

/** The job's uuid behind the number the page links by, or "". */
async function resolveJob(
  supabase: SessionClient,
  organizationId: string,
  jobNumber: string,
): Promise<string> {
  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return "";

  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  return typeof data?.id === "string" ? data.id : "";
}

/**
 * The folder a job's documents belong in.
 *
 * `documents.folder_id` is not null and restricts deletes, so nothing can be
 * filed without one — but the folder is almost never made here. A database
 * trigger files every job under Jobs → year → month as it is created, keyed
 * `job:<uuid>`, and keeps the name in step afterwards. Writing `job/<uuid>`
 * instead gave each job a second, orphaned folder holding its photos, parented
 * nowhere and absent from the files tree.
 */
async function jobFolderId(
  supabase: SessionClient,
  organizationId: string,
  jobId: string,
  jobNumber: string,
): Promise<string | null> {
  const folderKey = jobFolderKey(jobId);

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
      // The trigger's vocabulary, not a second one. It renames and reparents
      // this on the next change to the job.
      display_name: `JOB-${jobNumber || "?"}`,
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

/**
 * Permission to put one photo in one place.
 *
 * Everything that can be checked before a byte moves is checked here, so a
 * phone on a bad connection is not asked to upload five megabytes and only then
 * told the file type is wrong.
 */
export async function createJobPhotoUpload(input: {
  jobNumber: string;
  stage: "before" | "after";
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<PhotoUploadTicket> {
  const kind = photoKind(input.mimeType ?? "", input.fileName ?? "");
  if (!kind) {
    return { ok: false, error: "That file is not a photo. JPG, PNG, WebP and HEIC all work." };
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) {
    return { ok: false, error: "That photo looks empty. Try taking it again." };
  }
  if (input.sizeBytes > MAX_BYTES) {
    return { ok: false, error: "That photo is over 20 MB. Set the camera to a smaller size." };
  }

  const context = await callerContext();
  if (!context) return { ok: false, error: "You are not a member of a business." };

  const jobId = await resolveJob(context.supabase, context.organizationId, input.jobNumber);
  if (!jobId) return { ok: false, error: "That job could not be found." };

  const folderId = await jobFolderId(
    context.supabase,
    context.organizationId,
    jobId,
    input.jobNumber,
  );
  if (!folderId) return { ok: false, error: "This job's folder could not be prepared." };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    await ensureDocumentsBucket();
    admin = getSupabaseAdmin();
  } catch {
    return { ok: false, error: "Photo storage is not set up yet." };
  }

  const path = documentStoragePath(
    context.organizationId,
    `jobs/${jobId}`,
    `${randomUUID()}.${kind.extension}`,
  );

  const signed = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);

  if (signed.error || !signed.data?.token) {
    console.error("job photo: could not sign an upload", signed.error);
    return { ok: false, error: "That photo could not be started. Try again." };
  }

  return { ok: true, path, token: signed.data.token, bucket: DOCUMENTS_BUCKET };
}

/**
 * File the photo that has just landed in the bucket.
 *
 * The path is checked rather than trusted twice over: it has to sit under this
 * caller's organization and this job, and the object has to actually be there.
 * Without the first check a crafted call could attach another business's file
 * to this job; without the second, a failed upload would leave a row pointing at
 * nothing, which renders as a broken image forever.
 */
export async function recordJobPhoto(input: {
  jobNumber: string;
  stage: "before" | "after";
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<PhotoActionState> {
  const context = await callerContext();
  if (!context) return { error: "You are not a member of a business." };

  const jobId = await resolveJob(context.supabase, context.organizationId, input.jobNumber);
  if (!jobId) return { error: "That job could not be found." };

  const expectedPrefix = documentStoragePath(context.organizationId, `jobs/${jobId}`, "");
  if (!input.path || !input.path.startsWith(expectedPrefix)) {
    return { error: "That photo could not be attached to the job." };
  }

  const folderId = await jobFolderId(
    context.supabase,
    context.organizationId,
    jobId,
    input.jobNumber,
  );
  if (!folderId) return { error: "This job's folder could not be prepared." };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { error: "Photo storage is not set up yet." };
  }

  // Signing an object that is not there fails, which is the cheapest way to ask
  // "did the upload actually finish".
  const exists = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(input.path, 60);
  if (exists.error) {
    return { error: "That photo did not finish uploading. Try again." };
  }

  const kind = photoKind(input.mimeType ?? "", input.fileName ?? "");
  const stage = input.stage === "after" ? "after" : "before";

  const { error } = await context.supabase.from("documents").insert({
    organization_id: context.organizationId,
    folder_id: folderId,
    job_id: jobId,
    storage_path: input.path,
    file_name: input.fileName || `photo.${kind?.extension ?? "jpg"}`,
    display_name: stage === "after" ? "After" : "Before",
    document_type: stage === "after" ? "photo_after" : "photo_before",
    mime_type: kind?.mimeType ?? "image/jpeg",
    size_bytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
    // The insert policy requires this to be the caller, so a row written on
    // somebody else's behalf is rejected rather than silently misattributed.
    uploaded_by: context.userId,
  });

  if (error) {
    // The file is in the bucket and nothing points at it. Left alone it is a
    // stranded object nobody can find or delete through the app.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([input.path]);
    console.error("job photo: could not attach the document row", error);
    return { error: "That photo could not be attached to the job." };
  }

  revalidatePath(`/jobs/${input.jobNumber}`);
  return { error: "", notice: stage === "after" ? "After photo added." : "Before photo added." };
}

export async function removeJobPhoto(
  _previous: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const documentId = String(formData.get("documentId") ?? "").trim();
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
