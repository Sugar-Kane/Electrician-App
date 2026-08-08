import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client for provider webhooks.
 *
 * Inbound calls and texts arrive from Twilio and the voice platform with no
 * user session, so neither the cookie-bound server client nor the anon public
 * client can write the conversation. This client bypasses RLS and must only be
 * constructed inside a webhook route that has already verified the provider's
 * signature — never in a page, a component, or anything reachable by a browser.
 */
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase service environment variables are not configured.");
  }

  return createSupabaseClient(url, secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
