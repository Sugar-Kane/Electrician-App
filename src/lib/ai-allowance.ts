import "server-only";

import { AI_LIMIT_MESSAGE, aiUseAllowed, monthlyAiLimit, monthStart } from "@/lib/ai-allowance-rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export { AI_LIMIT_MESSAGE } from "@/lib/ai-allowance-rules";

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
  const limit = monthlyAiLimit(process.env.AI_MONTHLY_LIMIT);

  const { count, error } = await database
    .from("ai_usage")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", organizationId)
    .gte("created_at", monthStart(new Date()).toISOString());

  if (!error && !aiUseAllowed(count ?? 0, limit)) return { ok: false, message: AI_LIMIT_MESSAGE };
  if (error) console.error("ai usage could not be counted", { organizationId, code: error.code });

  const { error: insertError } = await database
    .from("ai_usage")
    .insert({ organization_id: organizationId, feature: feature.slice(0, 40) });
  if (insertError) console.error("ai usage could not be recorded", { organizationId, code: insertError.code });
  return { ok: true };
}
