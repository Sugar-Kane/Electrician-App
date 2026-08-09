import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Recording what a voice model asked the booking tools to do.
 *
 * Best-effort by construction: every failure here is swallowed. A call is in
 * progress with a customer on the line, and losing a log line is a far smaller
 * problem than turning one into a failed booking.
 */

type Database = ReturnType<typeof getSupabaseAdmin>;

export type McpLogEntry = {
  organizationId: string | null;
  method: string;
  toolName?: string;
  arguments?: Record<string, unknown>;
  resultText?: string;
  isError?: boolean;
  httpStatus?: number;
  durationMs?: number;
};

export async function logMcpCall(database: Database, entry: McpLogEntry): Promise<void> {
  try {
    await database.from("mcp_call_log").insert({
      organization_id: entry.organizationId,
      method: entry.method.slice(0, 120),
      tool_name: entry.toolName?.slice(0, 120) ?? null,
      arguments: entry.arguments ?? {},
      // Long enough for the whole slot list, which is the longest thing a tool
      // ever says back.
      result_text: entry.resultText?.slice(0, 4000) ?? null,
      is_error: entry.isError === true,
      http_status: entry.httpStatus ?? null,
      duration_ms: entry.durationMs ?? null,
    });
  } catch {
    // Deliberately silent.
  }
}
