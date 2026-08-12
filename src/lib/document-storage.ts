import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The bucket every business document lives in.
 *
 * It was created in one place only: the Google Drive OAuth callback. So a
 * business that never connected Drive — which is all of them so far — had no
 * bucket at all, and the first upload from anywhere else would have failed with
 * a message about a missing bucket that means nothing to an electrician.
 *
 * Creating it is idempotent and cheap, so every path that writes a document
 * calls this first rather than assuming somebody else went through OAuth.
 */

export const DOCUMENTS_BUCKET = "business-documents";

/** Fifty megabytes: a phone photo is three, and a scanned permit set can be forty. */
const MAX_BYTES = 50 * 1024 * 1024;

export async function ensureDocumentsBucket(): Promise<void> {
  const admin = getSupabaseAdmin();

  const existing = await admin.storage.getBucket(DOCUMENTS_BUCKET);
  if (existing.data) return;

  const created = await admin.storage.createBucket(DOCUMENTS_BUCKET, {
    // Private. The storage policies scope reads to organization members by the
    // first path segment, and a public bucket would make every customer's
    // panel photo world-readable to anybody who guessed a uuid.
    public: false,
    fileSizeLimit: MAX_BYTES,
  });

  if (created.error && !created.error.message.toLowerCase().includes("already exists")) {
    throw new Error("Document storage could not be prepared.");
  }
}

/**
 * Where an object goes inside the bucket.
 *
 * The organization id must be the first path segment: the storage policies read
 * it back out with `private.storage_object_organization_id` to decide who may
 * see the file. A path that starts with anything else is a file nobody can
 * read, including the person who uploaded it.
 */
export function documentStoragePath(
  organizationId: string,
  folder: string,
  fileName: string,
): string {
  return `${organizationId}/${folder}/${fileName}`;
}
