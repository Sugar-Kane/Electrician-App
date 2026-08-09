import "server-only";

import {
  BOOKING_TOOLS,
  buildDecision,
  callerPhone,
  customerWords,
  describeOutcome,
  slotList,
} from "@/lib/booking-tool-rules";
import {
  findOrCreateCustomerByPhone,
  loadIntakeContext,
  recordBookingRequest,
} from "@/lib/intake-shared";
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

/**
 * Who this booking belongs to.
 *
 * A per-call URL already knows. A console-configured one does not, so it falls
 * back to the number the model was told to collect — the organization is pinned
 * either way, which is the guarantee that actually matters.
 */
async function resolveCustomer(input: {
  database: Database;
  session: McpSession;
  args: Record<string, unknown>;
}): Promise<{ customerId: string; phone: string }> {
  if (input.session.customerId) {
    return { customerId: input.session.customerId, phone: input.session.phone ?? "" };
  }

  const phone = callerPhone(input.args);
  if (!phone) return { customerId: "", phone: "" };

  const customerId = await findOrCreateCustomerByPhone({
    database: input.database,
    organizationId: input.session.organizationId,
    phone,
    note: "Created from an inbound phone call.",
    channel: "phone",
    contactName: typeof input.args.contact_name === "string" ? input.args.contact_name : "",
  });

  return { customerId: customerId ?? "", phone };
}

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

  const { customerId, phone } = await resolveCustomer({
    database: input.database,
    session: input.session,
    args: input.args,
  });

  if (!customerId) {
    return {
      isError: true,
      text: "NOT BOOKED. Ask the caller for the best phone number to reach them on, then call this again with caller_phone set.",
    };
  }

  await recordBookingRequest({
    database: input.database,
    organizationId: input.session.organizationId,
    customerId,
    phone,
    action,
    callerText,
    model: "grok-voice",
    decision,
  });

  return describeOutcome({ name: input.name, action, context, phone });
}
