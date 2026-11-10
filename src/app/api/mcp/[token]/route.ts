import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";

import { BOOKING_TOOLS, runBookingTool } from "@/lib/booking-tools";
import { BUSINESS_MCP_TOOLS, runBusinessMcpTool } from "@/lib/mcp-business-tools";
import { SUPPLIER_ORDER_MCP_TOOLS, runSupplierOrderMcpTool } from "@/lib/mcp-supplier-order-tools";
import { TASK_MCP_TOOLS, isTaskTool, runTaskTool } from "@/lib/mcp-task-tools";
import { PAID_INVOICE_MCP_TOOLS, isPaidInvoiceTool, runPaidInvoiceTool } from "@/lib/mcp-paid-invoice-tools";
import { CUSTOMER_MCP_TOOLS, isCustomerTool, runCustomerTool } from "@/lib/mcp-customer-tools";
import { describeNeedsAction, loadNeedsAction } from "@/lib/needs-action";
import { TASK_ASSISTANT_MCP_TOOLS, isTaskAssistantTool, runTaskAssistantTool } from "@/lib/mcp-task-assistant-tools";
import { assistantDeps, startQueuedWorkSoon } from "@/lib/task-assistant-server";
import type { Actor } from "@/lib/tasks-service";
import { isTimeZone } from "@/lib/task-rules";
import { TEXT_HISTORY_MCP_TOOLS, isTextHistoryTool, runTextHistoryTool, type HistoryDatabase } from "@/lib/mcp-text-history";
import { WORKDAY_MCP_TOOLS, runWorkdayMcpTool } from "@/lib/mcp-workday-tools";
import { organizationTimeZone } from "@/lib/job-billing-server";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { logMcpCall } from "@/lib/mcp-log";
import { handleMcpRequest } from "@/lib/mcp-protocol";
import { bearerAccepted, isMcpConfigured, readSession } from "@/lib/mcp-session";
import { connectionHolderAllowed } from "@/lib/mcp-session-token";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const SERVER_VERSION = "1.14.0";

/*
 * Room for the confirmations that `runBookingTool` schedules with `after`.
 *
 * `after` runs inside the route's budget, and this route set none — so the work
 * that tells a customer their appointment exists was living on whatever the
 * platform default happened to be. Stated here so the sends have somewhere to
 * finish, and so the number is a decision rather than a default.
 */
export const maxDuration = 60;

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

function rpcError(status: number, code: number, message: string) {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);
}

/**
 * Who task tools act as: the person who created this connection, but only
 * while they are still a member of the business. Never anything the request
 * says. A connection made before links recorded their creator gets none, and
 * the tools ask for a new link.
 */
async function taskActor(database: ReturnType<typeof getSupabaseAdmin>, organizationId: string, userId: string): Promise<Actor | null> {
  if (!userId) return null;
  const [{ data: member }, { data: profile }, timeZone] = await Promise.all([
    database.from("organization_members").select("role").eq("organization_id", organizationId).eq("user_id", userId).maybeSingle(),
    database.from("user_profiles").select("timezone").eq("user_id", userId).maybeSingle(),
    organizationTimeZone(asFlexibleClient(database), organizationId),
  ]);
  if (!member) return null;
  const own = typeof profile?.timezone === "string" && isTimeZone(profile.timezone) ? profile.timezone : "";
  return {
    userId,
    organizationId,
    role: typeof member.role === "string" ? member.role : "",
    timeZone: own || timeZone,
    via: "chatgpt",
  };
}

function describeRequest(body: unknown): { method: string; toolName?: string } {
  const first = Array.isArray(body) ? body[0] : body;
  if (typeof first !== "object" || first === null) return { method: "unparseable" };
  const record = first as Record<string, unknown>;
  const method = typeof record.method === "string" ? record.method : "none";
  const params = typeof record.params === "object" && record.params !== null ? (record.params as Record<string, unknown>) : {};
  return { method, toolName: typeof params.name === "string" ? params.name : undefined };
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  const startedAt = Date.now();
  if (!isMcpConfigured()) return rpcError(503, -32001, "MCP_SESSION_SECRET is not set on this deployment");
  if (!bearerAccepted(request.headers.get("authorization"))) return rpcError(401, -32001, "Unauthorized");

  const { token } = await context.params;
  const session = readSession(token);
  const database = getSupabaseAdmin();
  if (!session) return rpcError(404, -32001, "Session not found");
  // Groups this call's log rows together. A hash, so the log never holds a
  // URL that would still work.
  const sessionKey = createHash("sha256").update(token).digest("hex").slice(0, 32);

  const business = session.scope === "business";
  // The person who made this connection link, from Volteira's own record of it.
  let connectedBy = "";
  if (business) {
    if (!session.credentialId) return rpcError(401, -32001, "Reconnect ChatGPT from Volteira: Settings → Use in ChatGPT or Claude");
    const { data: credential } = await database
      .from("mcp_business_credentials")
      .select("id, created_by")
      .eq("id", session.credentialId)
      .eq("organization_id", session.organizationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!credential) return rpcError(401, -32001, "This ChatGPT connection has been revoked or expired");
    connectedBy = typeof credential.created_by === "string" ? credential.created_by : "";
    // The connection acts for the whole business, so it lasts only while the
    // person who made it is still an owner there. Removed or demoted, their
    // link stops working at once rather than at its expiry.
    const { data: holder } = connectedBy
      ? await database
          .from("organization_members")
          .select("role")
          .eq("organization_id", session.organizationId)
          .eq("user_id", connectedBy)
          .maybeSingle()
      : { data: null };
    if (!connectionHolderAllowed(holder?.role)) {
      return rpcError(401, -32001, "The owner who connected ChatGPT is no longer an owner here. Reconnect from Volteira: Settings → Use in ChatGPT or Claude");
    }
    // A query only runs once awaited, and `after` keeps it off the reply's path.
    const credentialId = session.credentialId;
    after(async () => {
      await database.from("mcp_business_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", credentialId);
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, "Parse error: invalid JSON");
  }

  const tools = business
    ? [...WORKDAY_MCP_TOOLS, ...BUSINESS_MCP_TOOLS, ...PAID_INVOICE_MCP_TOOLS, ...CUSTOMER_MCP_TOOLS, ...TASK_MCP_TOOLS, ...TASK_ASSISTANT_MCP_TOOLS, ...TEXT_HISTORY_MCP_TOOLS, ...SUPPLIER_ORDER_MCP_TOOLS, ...BOOKING_TOOLS]
    : BOOKING_TOOLS;
  const workdayNames = new Set(WORKDAY_MCP_TOOLS.map((tool) => tool.name));
  const businessNames = new Set(BUSINESS_MCP_TOOLS.map((tool) => tool.name));
  const supplierNames = new Set(SUPPLIER_ORDER_MCP_TOOLS.map((tool) => tool.name));

  const reply = await handleMcpRequest(body, {
    serverInfo: { name: business ? "electrician-business" : "electrician-booking", version: SERVER_VERSION },
    tools,
    callTool: async (name, args) => {
      const toolStartedAt = Date.now();
      const result = business && workdayNames.has(name)
        ? await runWorkdayMcpTool({ database, session, name, args })
        : business && businessNames.has(name)
        ? await runBusinessMcpTool({ database, session, name, args })
        : business && isTaskTool(name)
        ? await runTaskTool({
            database: asFlexibleClient(database),
            actor: await taskActor(database, session.organizationId, connectedBy),
            name,
            args,
            needsAction: async () => {
              const timeZone = await organizationTimeZone(asFlexibleClient(database), session.organizationId);
              const needs = await loadNeedsAction(asFlexibleClient(database), session.organizationId, timeZone);
              return { lines: describeNeedsAction(needs), items: needs.items };
            },
          })
        : business && isCustomerTool(name)
        ? await runCustomerTool({ database: asFlexibleClient(database), organizationId: session.organizationId, name, args })
        : business && isPaidInvoiceTool(name)
        ? await runPaidInvoiceTool({
            database: asFlexibleClient(database),
            organizationId: session.organizationId,
            actorUserId: (await taskActor(database, session.organizationId, connectedBy))?.userId ?? null,
            timeZone: await organizationTimeZone(asFlexibleClient(database), session.organizationId),
            name,
            args,
          })
        : business && isTaskAssistantTool(name)
        ? await runTaskAssistantTool({
            database: asFlexibleClient(database),
            actor: await taskActor(database, session.organizationId, connectedBy),
            deps: assistantDeps(),
            name,
            args,
            onQueued: startQueuedWorkSoon,
          })
        : business && isTextHistoryTool(name)
        ? await runTextHistoryTool({
            database: database as unknown as HistoryDatabase,
            organizationId: session.organizationId,
            timeZone: await organizationTimeZone(asFlexibleClient(database), session.organizationId),
            name,
            args,
          })
        : business && supplierNames.has(name)
          ? await runSupplierOrderMcpTool({ database, session, name, args })
          : await runBookingTool({ database, session, name, args });
      await logMcpCall(database, {
        organizationId: session.organizationId,
        method: "tools/call",
        toolName: name,
        arguments: args,
        resultText: result.logText ?? result.text,
        isError: result.isError === true,
        durationMs: Date.now() - toolStartedAt,
        sessionKey,
        bookingRequestId: result.record?.bookingRequestId,
        jobId: result.record?.jobId,
      });
      return result;
    },
  });

  const described = describeRequest(body);
  if (described.method !== "tools/call") {
    await logMcpCall(database, {
      organizationId: session.organizationId,
      method: described.method,
      httpStatus: reply.status,
      durationMs: Date.now() - startedAt,
      sessionKey,
    });
  }

  if (reply.body === undefined) return new NextResponse(null, { status: reply.status });
  return json(reply.body, reply.status);
}

export async function GET() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}

export function DELETE() {
  return new NextResponse("Method Not Allowed", { status: 405, headers: { Allow: "POST" } });
}
