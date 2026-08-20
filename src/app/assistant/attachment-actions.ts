"use server";

import { randomUUID } from "node:crypto";

import {
  attachmentKind,
  refuseAttachment,
  type Reading,
} from "@/lib/attachment-kinds";
import { documentFolderId } from "@/lib/document-folders";
import {
  DOCUMENTS_BUCKET,
  documentStoragePath,
  ensureDocumentsBucket,
} from "@/lib/document-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Attaching a photo, a PDF or a video to a question.
 *
 * The file never travels through this server, for the same reason job photos
 * stopped doing so: a Server Action's request body is capped around a megabyte
 * by the framework and about four and a half by the platform, and a phone photo
 * is three to five. Posting the file to an action means the request is rejected
 * before the action runs, so every careful message below would be unreachable
 * and the person would get a bare page error instead.
 *
 * So the browser uploads straight to storage, and the server does the two things
 * only it can do: decide where the file is allowed to go, and write the row that
 * points at it.
 *
 * The client never chooses the path. `createAssistantUpload` builds it and signs
 * a token good for that one object; `recordAssistantAttachment` refuses anything
 * that did not land where it was sent, because otherwise a crafted call could
 * file another business's object against this conversation.
 */

export type UploadTicket =
  | { ok: true; path: string; token: string; bucket: string }
  | { ok: false; error: string };

export type RecordResult =
  | { ok: true; documentId: string; reading: Reading }
  | { ok: false; error: string };

/** Where attachments with no job of their own are filed. */
const FOLDER_KEY = "assistant";
const FOLDER_NAME = "Assistant";

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

  const organizationId = typeof data?.organization_id === "string" ? data.organization_id : "";
  if (!organizationId) return null;

  return { supabase, organizationId, userId };
}

/**
 * Permission to put one file in one place.
 *
 * Everything checkable before a byte moves is checked here, so a phone on a bad
 * connection is not asked to upload forty megabytes and only then told the
 * format is wrong.
 */
export async function createAssistantUpload(input: {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<UploadTicket> {
  const refusal = refuseAttachment(input);
  if (refusal) return { ok: false, error: refusal };

  const kind = attachmentKind(input.mimeType, input.fileName);
  if (!kind) return { ok: false, error: "That file type is not supported." };

  const context = await callerContext();
  if (!context) return { ok: false, error: "You are not a member of a business." };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    await ensureDocumentsBucket();
    admin = getSupabaseAdmin();
  } catch {
    return { ok: false, error: "File storage is not set up yet." };
  }

  // The organization id has to be the first segment: the storage policies read
  // it back out to decide who may see the object. A path starting with anything
  // else is a file nobody can read, including whoever uploaded it.
  const path = documentStoragePath(
    context.organizationId,
    FOLDER_KEY,
    `${randomUUID()}.${kind.extension}`,
  );

  const signed = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUploadUrl(path);
  if (signed.error || !signed.data?.token) {
    console.error("assistant attachment: could not sign an upload", signed.error);
    return { ok: false, error: "That file could not be started. Try again." };
  }

  return { ok: true, path, token: signed.data.token, bucket: DOCUMENTS_BUCKET };
}

/**
 * File the object that has just landed in the bucket.
 *
 * The path is checked twice over rather than trusted: it has to sit under this
 * caller's organization, and the object has to actually be there. Without the
 * first a crafted call attaches somebody else's file; without the second a
 * failed upload leaves a row pointing at nothing.
 */
export async function recordAssistantAttachment(input: {
  path: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
}): Promise<RecordResult> {
  const context = await callerContext();
  if (!context) return { ok: false, error: "You are not a member of a business." };

  const expectedPrefix = documentStoragePath(context.organizationId, FOLDER_KEY, "");
  if (!input.path || !input.path.startsWith(expectedPrefix)) {
    return { ok: false, error: "That file could not be attached." };
  }

  const kind = attachmentKind(input.mimeType, input.fileName);
  if (!kind) return { ok: false, error: "That file type is not supported." };

  let admin: ReturnType<typeof getSupabaseAdmin>;
  try {
    admin = getSupabaseAdmin();
  } catch {
    return { ok: false, error: "File storage is not set up yet." };
  }

  // Signing an object that is not there fails, which is the cheapest way to ask
  // "did the upload actually finish".
  const exists = await admin.storage.from(DOCUMENTS_BUCKET).createSignedUrl(input.path, 60);
  if (exists.error) {
    return { ok: false, error: "That file did not finish uploading. Try again." };
  }

  const folderId = await documentFolderId({
    database: context.supabase,
    organizationId: context.organizationId,
    jobId: "",
    jobNumber: "",
    fallbackKey: FOLDER_KEY,
    fallbackName: FOLDER_NAME,
  });
  if (!folderId) return { ok: false, error: "The assistant's folder could not be prepared." };

  const { data, error } = await context.supabase
    .from("documents")
    .insert({
      organization_id: context.organizationId,
      folder_id: folderId,
      storage_path: input.path,
      file_name: input.fileName || `attachment.${kind.extension}`,
      display_name: input.fileName || "Attachment",
      document_type: "assistant_attachment",
      mime_type: kind.mimeType,
      size_bytes: Number.isFinite(input.sizeBytes) ? input.sizeBytes : 0,
      // The insert policy requires this to be the caller, so a row written on
      // somebody else's behalf is rejected rather than quietly misattributed.
      uploaded_by: context.userId,
    })
    .select("id")
    .maybeSingle();

  const documentId = typeof data?.id === "string" ? data.id : "";

  if (error || !documentId) {
    // The file is in the bucket and nothing points at it. Left alone that is a
    // stranded object nobody can find or delete through the app.
    await admin.storage.from(DOCUMENTS_BUCKET).remove([input.path]);
    console.error("assistant attachment: could not write the document row", error);
    return { ok: false, error: "That file could not be attached." };
  }

  return { ok: true, documentId, reading: kind.reading };
}
