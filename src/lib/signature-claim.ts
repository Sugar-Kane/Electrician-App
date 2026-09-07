import "server-only";

import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

export const SIGNATURE_CLAIM_TTL_MS = 10 * 60_000;

export function signatureClaimStaleBefore(now: number = Date.now()): string {
  return new Date(now - SIGNATURE_CLAIM_TTL_MS).toISOString();
}

/**
 * Clear abandoned draft locks across a whole job before taking a new one.
 *
 * The database's job-wide unique index prevents two live claims. Cleaning only
 * the target draft, however, lets a crashed send on an older draft block every
 * newer draft forever.
 */
export async function clearStaleSignatureClaimsForJob(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; staleBefore: string },
): Promise<boolean> {
  const { error } = await database
    .from("contracts")
    .update({ signature_send_token: null, signature_send_started_at: null })
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId)
    .eq("status", "draft")
    .not("signature_send_token", "is", null)
    .or(`signature_send_started_at.is.null,signature_send_started_at.lt.${input.staleBefore}`);

  if (error) {
    console.error("contract: stale signature claims could not be cleared", error);
    return false;
  }
  return true;
}
