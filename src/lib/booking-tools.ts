import "server-only";

import {
  BOOKING_TOOLS,
  buildDecision,
  customerWords,
  describeOutcome,
  slotList,
} from "@/lib/booking-tool-rules";
import { loadIntakeContext, recordBookingRequest } from "@/lib/intake-shared";
import { type ToolResult } from "@/lib/mcp-protocol";
import { type McpSession } from "@/lib/mcp-session-token";
import { decideIntakeAction } from "@/lib/sms-intake";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * Running a booking tool against the real schedule.
 *
 * Deliberately thin: the rules, the tool definitions, and every word sent back
 * to the model live in booking-tool-rules, where they are tested. What is left
 * here is the part that needs a database — load the context, run the proposal
 * past `decideIntakeAction`, write whatever it approved.
 */

export { BOOKING_TOOLS };

type Database = ReturnType<typeof getSupabaseAdmin>;

export async function runBookingTool(input: {
  database: Database;
  session: McpSession;
  name: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const { context } = await loadIntakeContext({
    database: input.database,
    organizationId: input.session.organizationId,
    // A phone call has no thread and sends no SMS, so the opt-out footer that
    // belongs on a first text has no place in anything said out loud.
    isFirstReply: false,
  });

  if (input.name === "list_open_slots") return { text: slotList(context) };

  const decision = buildDecision(input.name, input.args);
  if (!decision) return { isError: true, text: `NOT BOOKED. Unknown tool: ${input.name}` };

  const callerText = customerWords(input.args);
  const action = decideIntakeAction({ decision, customerText: callerText, context });

  await recordBookingRequest({
    database: input.database,
    organizationId: input.session.organizationId,
    customerId: input.session.customerId,
    phone: input.session.phone,
    action,
    callerText,
    model: "grok-voice",
    decision,
  });

  return describeOutcome({
    name: input.name,
    action,
    context,
    phone: input.session.phone,
  });
}
