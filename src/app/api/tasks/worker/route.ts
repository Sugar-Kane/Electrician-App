import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { runTaskWorker } from "@/lib/task-worker";

/**
 * The task worker, called by the database's scheduler (pg_cron + pg_net) when
 * reminders or recurring tasks are due. The caller must present the token kept
 * in Supabase Vault; it is checked against Vault itself, so it never has to be
 * copied anywhere. Any other caller gets 401 and nothing runs.
 */

export const maxDuration = 60;
const NO_STORE = { "Cache-Control": "no-store" };

export async function POST(request: Request) {
  const token = request.headers.get("x-task-worker-token") ?? "";
  if (token.length < 32) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });
  const admin = getSupabaseAdmin();
  const { data: allowed, error } = await admin.rpc("task_worker_token_ok", { p_token: token });
  if (error || allowed !== true) return Response.json({ error: "Unauthorized" }, { status: 401, headers: NO_STORE });

  try {
    const report = await runTaskWorker(asFlexibleClient(admin));
    return Response.json(report, { headers: NO_STORE });
  } catch (failure) {
    console.error("task worker run failed", { message: failure instanceof Error ? failure.message : "unknown" });
    return Response.json({ error: "The run failed; due work stays queued for the next run." }, { status: 500, headers: NO_STORE });
  }
}
