import "server-only";

import { cache } from "react";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Who is asking, resolved once per request instead of once per query.
 *
 * Eight data modules each opened with `auth.getUser()` followed by a membership
 * lookup. `getUser()` is not a local token decode — it calls the Supabase auth
 * server to verify the JWT — so a page pulling from three of those modules paid
 * for three verification round trips and three membership queries before it
 * rendered anything. That is most of the delay between tapping a menu item and
 * seeing the page.
 *
 * React's `cache()` scopes memoisation to a single request, which is exactly
 * the lifetime wanted here: two components on the same page share one answer,
 * and the next request re-verifies rather than trusting a stale one. Nothing is
 * cached across users or across requests.
 */

export type SessionContext = {
  userId: string;
  email: string;
  organizationId: string;
  timeZone: string;
  role: string;
};

export const DEFAULT_TIME_ZONE = "America/Los_Angeles";

/** The verified user, or null when signed out. One call per request. */
export const currentUser = cache(async () => {
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  return data.user ?? null;
});

/**
 * The organization this request acts for, with its timezone.
 *
 * Null for a signed-out visitor or an account with no membership — both of
 * which are ordinary states, not errors: the first sees the marketing view and
 * the second is somebody waiting on an invitation.
 */
export const currentContext = cache(async (): Promise<SessionContext | null> => {
  const user = await currentUser();
  if (!user) return null;

  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("organization_members")
    .select("organization_id, role, organizations ( timezone )")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();

  const row = (data ?? null) as Record<string, unknown> | null;
  const organizationId = typeof row?.organization_id === "string" ? row.organization_id : "";
  if (!organizationId) return null;

  const organization = (row?.organizations ?? null) as Record<string, unknown> | null;
  const timeZone =
    typeof organization?.timezone === "string" && organization.timezone
      ? organization.timezone
      : DEFAULT_TIME_ZONE;

  return {
    userId: user.id,
    email: user.email ?? "",
    organizationId,
    timeZone,
    role: typeof row?.role === "string" ? row.role : "",
  };
});
