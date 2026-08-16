import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Where a tenant's logo lives.
 *
 * A separate, public bucket rather than `business-documents`, which is private
 * on purpose and served through signed URLs. A signed URL is exactly wrong for
 * this: it expires, so a cached booking page would start showing a broken image
 * an hour after it rendered, and it is unguessable, which is a property a logo
 * on a public marketing page does not want and cannot use.
 *
 * Nothing but logos goes in here. The rule is worth stating because the bucket
 * is world-readable and the next person looking for somewhere to put a file
 * will find it first.
 */

export const BRANDING_BUCKET = "public-branding";

/** Two megabytes. A logo that needs more than that is a photograph. */
const MAX_BYTES = 2 * 1024 * 1024;

export async function ensureBrandingBucket(): Promise<void> {
  const admin = getSupabaseAdmin();

  const existing = await admin.storage.getBucket(BRANDING_BUCKET);
  if (existing.data) return;

  const created = await admin.storage.createBucket(BRANDING_BUCKET, {
    public: true,
    fileSizeLimit: MAX_BYTES,
    allowedMimeTypes: ["image/png", "image/jpeg", "image/webp", "image/svg+xml"],
  });

  if (created.error && !created.error.message.toLowerCase().includes("already exists")) {
    throw new Error("Branding storage could not be prepared.");
  }
}

/**
 * The URL a browser loads the logo from.
 *
 * Built by hand rather than through `getPublicUrl` so it can be called from a
 * server component without a client, and so the booking page stays cacheable —
 * the same path always produces the same URL.
 */
export function logoUrl(path: string | null | undefined): string {
  const clean = (path ?? "").trim().replace(/^\/+/, "");
  if (clean === "") return "";

  const base = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
  if (base === "") return "";

  return `${base}/storage/v1/object/public/${BRANDING_BUCKET}/${clean}`;
}
