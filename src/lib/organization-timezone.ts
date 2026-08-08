import "server-only";

import { createClient } from "@/lib/supabase/server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * The signed-in user's business timezone.
 *
 * `organizations.timezone` is the one timezone that matters: quiet hours,
 * message timestamps, arrival windows and the schedule are all rendered in it.
 * Pages that need a date resolve it here rather than trusting the server's
 * clock, which in production is UTC.
 *
 * Falls back to the default for signed-out visitors and demo views.
 */
export async function getOrganizationTimezone(): Promise<string> {
  try {
    const supabase = await createClient();
    const { data: authData } = await supabase.auth.getUser();
    if (!authData.user) return DEFAULT_TIMEZONE;

    const { data: membership } = await asFlexibleClient(supabase)
      .from("organization_members")
      .select("organizations(timezone)")
      .eq("user_id", authData.user.id)
      .limit(1)
      .maybeSingle();

    const row = membership as unknown as { organizations?: { timezone?: unknown } | null } | null;
    const organization = row?.organizations ?? null;
    return typeof organization?.timezone === "string" && organization.timezone
      ? organization.timezone
      : DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
