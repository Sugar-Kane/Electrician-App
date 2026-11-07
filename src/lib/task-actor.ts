import "server-only";

import { currentContext } from "@/lib/request-context";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { isTimeZone } from "@/lib/task-rules";
import type { Actor } from "@/lib/tasks-service";

/**
 * The signed-in person as a task actor, with the session's own database client,
 * so row-level security applies on top of the service's checks. Their own time
 * zone if they set one, else the business's.
 */
export async function appTaskActor(): Promise<{ db: FlexibleSupabaseClient; actor: Actor } | null> {
  const context = await currentContext();
  if (!context) return null;
  const db = asFlexibleClient(await createClient());
  const { data: profile } = await db.from("user_profiles").select("timezone").eq("user_id", context.userId).maybeSingle();
  const own = typeof profile?.timezone === "string" && isTimeZone(profile.timezone) ? profile.timezone : "";
  return {
    db,
    actor: {
      userId: context.userId,
      organizationId: context.organizationId,
      role: context.role,
      timeZone: own || context.timeZone,
      via: "app",
    },
  };
}
