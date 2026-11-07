import "server-only";

import { after } from "next/server";

import { takeAiUse } from "@/lib/ai-allowance";
import { decideTaskStep } from "@/lib/claude";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import type { AssistantDeps } from "@/lib/task-executions";
import { runTaskWorker } from "@/lib/task-worker";
import { sendSms } from "@/lib/twilio";

/**
 * The real pieces behind assistant work: Claude for decisions, Twilio for
 * approved texts, the business's AI allowance. Server only.
 */
export function assistantDeps(): AssistantDeps {
  return {
    // A connection names where its key lives ("env:NAME"); only whether it is
    // set is ever looked at, never its value.
    credentialAvailable: (ref) => {
      const match = /^env:([A-Z0-9_]+)$/.exec(ref);
      return Boolean(match && process.env[match[1]!]);
    },
    decide: decideTaskStep,
    sendText: sendSms,
    takeAiUse,
  };
}

/** The server client for assistant writes; callers check who is acting first. */
export function assistantDatabase() {
  return asFlexibleClient(getSupabaseAdmin());
}

/**
 * Work queued now starts after this response, rather than at the scheduler's
 * next minute. Safe to overlap with the scheduler: rows are claimed with a
 * lease, so each is run once.
 */
export function startQueuedWorkSoon(): void {
  after(async () => {
    try {
      await runTaskWorker(assistantDatabase(), { assistant: assistantDeps(), budgetMs: 40_000 });
    } catch (error) {
      console.error("task work could not start early", { message: error instanceof Error ? error.message : "unknown" });
    }
  });
}
