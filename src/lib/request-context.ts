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

  // A platform admin who has opened somebody else's business acts for that
  // business, not their own. The session is the authority — it carries its own
  // expiry, so a forgotten tab stops acting rather than acting forever.
  const impersonating = await currentImpersonation();

  const query = supabase
    .from("organization_members")
    .select("organization_id, role, organizations ( timezone )")
    .eq("user_id", user.id);

  const { data } = impersonating
    ? await query.eq("organization_id", impersonating.organizationId).maybeSingle()
    : await query.limit(1).maybeSingle();

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

export type Impersonation = {
  sessionId: string;
  organizationId: string;
  organizationName: string;
  expiresAt: string;
};

/**
 * The business this admin has opened, if any.
 *
 * Read from the database rather than a cookie, so ending a session ends it
 * everywhere at once — including in a tab the admin forgot about — and so a
 * cookie cannot be edited into acting for a business nobody granted.
 *
 * Expired sessions are filtered out by the function itself, so nothing here has
 * to remember to check the clock.
 */
export const currentImpersonation = cache(async (): Promise<Impersonation | null> => {
  const user = await currentUser();
  if (!user) return null;

  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase.rpc("my_impersonation");
  const row = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;
  if (!row) return null;

  const str = (value: unknown) => (typeof value === "string" ? value : "");
  const organizationId = str(row.organization_id);
  if (!organizationId) return null;

  return {
    sessionId: str(row.session_id),
    organizationId,
    organizationName: str(row.organization_name),
    expiresAt: str(row.expires_at),
  };
});
