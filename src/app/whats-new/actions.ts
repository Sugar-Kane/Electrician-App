"use server";

import { CURRENT_VERSION } from "@/lib/releases";
import { createClient } from "@/lib/supabase/server";

/**
 * The signed-in person has seen this release's "What's new". Saved on their
 * account (user metadata), so it does not show again on any device until the
 * next release. Only ever records the current version, never one from the
 * client.
 */
export async function markReleaseSeen(): Promise<void> {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return;
  if (data.user.user_metadata?.last_seen_release === CURRENT_VERSION) return;
  const { error } = await supabase.auth.updateUser({
    data: { ...data.user.user_metadata, last_seen_release: CURRENT_VERSION },
  });
  if (error) {
    console.error("could not record release seen", { message: error.message });
    return;
  }
  // So the next page reads the new value from a fresh token, not the old one.
  await supabase.auth.refreshSession();
}
