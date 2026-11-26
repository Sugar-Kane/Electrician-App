import { createHash } from "node:crypto";
import { after, NextResponse } from "next/server";

import { BOOKING_TOOLS } from "@/lib/booking-tools";
import { BUSINESS_MCP_TOOLS } from "@/lib/mcp-business-tools";
import { SUPPLIER_ORDER_MCP_TOOLS } from "@/lib/mcp-supplier-order-tools";
import { PAID_INVOICE_MCP_TOOLS } from "@/lib/mcp-paid-invoice-tools";
import { CUSTOMER_MCP_TOOLS } from "@/lib/mcp-customer-tools";
import { TEXT_HISTORY_MCP_TOOLS } from "@/lib/mcp-text-history";
import { WORKDAY_MCP_TOOLS } from "@/lib/mcp-workday-tools";
import { SUPERVISED_MCP_TOOLS, supervisedMcpEnabled } from "@/lib/mcp-supervised-tools";
import { RELEASE_MCP_TOOLS } from "@/lib/mcp-release-tools";
import { CHANGE_ORDER_MCP_TOOLS } from "@/lib/mcp-change-order-tools";
import { logMcpCall } from "@/lib/mcp-log";
import { handleMcpRequest } from "@/lib/mcp-protocol";
import { bearerAccepted, isMcpConfigured, readSession } from "@/lib/mcp-session";
import { authorizeBusinessMcpConnection } from "@/lib/mcp-business-authorization";
import { businessConnectionLookups, callToolFromChatGpt } from "@/lib/mcp-dispatch";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const SERVER_VERSION = "1.17.0";

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
    // One decision, tested on its own (mcp-business-authorization.ts): a live
    // credential of this same business, made by someone still an owner here.
    const verdict = await authorizeBusinessMcpConnection(session, businessConnectionLookups(database));
    if (!verdict.ok) return rpcError(verdict.status, -32001, verdict.message);
    connectedBy = verdict.connectedBy;
    // A query only runs once awaited, and `after` keeps it off the reply's path.
    // Scoped by business as well as id, like every other write here.
    const credentialId = session.credentialId ?? "";
    const organizationId = session.organizationId;
    after(async () => {
      await database
        .from("mcp_business_credentials")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", credentialId)
        .eq("organization_id", organizationId);
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, "Parse error: invalid JSON");
  }

  // Phase 2 supervised actions: offered only where VOLTEIRA_PHASE2_MCP_ENABLED is on.
  const supervised = business && supervisedMcpEnabled();
  const tools = business
    ? [...WORKDAY_MCP_TOOLS, ...BUSINESS_MCP_TOOLS, ...PAID_INVOICE_MCP_TOOLS, ...CHANGE_ORDER_MCP_TOOLS, ...CUSTOMER_MCP_TOOLS, ...TEXT_HISTORY_MCP_TOOLS, ...SUPPLIER_ORDER_MCP_TOOLS, ...(supervised ? SUPERVISED_MCP_TOOLS : []), ...RELEASE_MCP_TOOLS, ...BOOKING_TOOLS]
    : BOOKING_TOOLS;

  const reply = await handleMcpRequest(body, {
    serverInfo: { name: business ? "electrician-business" : "electrician-booking", version: SERVER_VERSION },
    tools,
    callTool: async (name, args) => {
      const toolStartedAt = Date.now();
      // A confirmed call that reaches a customer or moves money waits for the
      // owner's approval in Volteira instead of running (mcp-approval.ts).
      const result = await callToolFromChatGpt({ database, session, connectedBy }, name, args);
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
