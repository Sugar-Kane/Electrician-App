import "server-only";

import { AI_LIMIT_MESSAGE, aiUseAllowed, monthStart, resolveAiLimit, type AiLimit } from "@/lib/ai-allowance-rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export { AI_LIMIT_MESSAGE } from "@/lib/ai-allowance-rules";

type Database = ReturnType<typeof getSupabaseAdmin>;

/**
 * The allowance that applies to a business now: its own setting from the
 * admin console, the paid plan, the platform default, then the deployment's.
 */
async function limitFor(database: Database, organizationId: string): Promise<AiLimit> {
  const [own, platform, subscription] = await Promise.all([
    database.from("organization_ai_allowances").select("monthly_limit, unlimited").eq("organization_id", organizationId).maybeSingle(),
    database.from("platform_settings").select("ai_default_monthly_limit").eq("id", true).maybeSingle(),
    database.from("organization_subscriptions").select("status").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const row = (own.data ?? {}) as Record<string, unknown>;
  const settings = (platform.data ?? {}) as Record<string, unknown>;
  return resolveAiLimit({
    unlimited: row.unlimited === true,
    subscriptionStatus: typeof subscription.data?.status === "string" ? subscription.data.status : null,
    businessLimit: typeof row.monthly_limit === "number" ? row.monthly_limit : null,
    platformDefault: typeof settings.ai_default_monthly_limit === "number" ? settings.ai_default_monthly_limit : null,
    configured: process.env.AI_MONTHLY_LIMIT,
  });
}

async function usedThisMonth(database: Database, organizationId: string): Promise<number | null> {
  const { count, error } = await database
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", monthStart(new Date()).toISOString());
  if (error) {
    console.error("ai usage could not be counted", { organizationId, code: error.code });
    return null;
  }
  return count ?? 0;
}

/** This month's use against the allowance, for the account page and the admin console. */
export async function aiUsageSummary(organizationId: string): Promise<{ used: number; limit: AiLimit }> {
  const database = getSupabaseAdmin();
  const [limit, used] = await Promise.all([limitFor(database, organizationId), usedThisMonth(database, organizationId)]);
  return { used: used ?? 0, limit };
}

/**
 * Take one use of the built-in AI for a business, or say it has used this
 * month's allowance (ai-allowance-rules.ts).
 *
 * Called before the AI runs, by every feature an electrician starts. The use
 * is written down as it is taken, so two at once can both get in at the edge
 * of the limit; that is a use or two over, never a bill. If the count cannot
 * be read the use is allowed: a database hiccup should not switch off a
 * feature somebody is in the middle of.
 */
export async function takeAiUse(
  organizationId: string,
  feature: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (!organizationId) return { ok: false, message: "Sign in to use this." };
  const database = getSupabaseAdmin();
  const [limit, used] = await Promise.all([limitFor(database, organizationId), usedThisMonth(database, organizationId)]);

  if (used !== null && !aiUseAllowed(used, limit)) return { ok: false, message: AI_LIMIT_MESSAGE };

  const { error } = await database
    .from("ai_usage")
    .insert({ organization_id: organizationId, feature: feature.slice(0, 40) });
  if (error) console.error("ai usage could not be recorded", { organizationId, code: error.code });
  return { ok: true };
}
