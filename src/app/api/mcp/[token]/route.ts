import { NextResponse } from "next/server";

import { BOOKING_TOOLS, runBookingTool } from "@/lib/booking-tools";
import { BUSINESS_MCP_TOOLS, runBusinessMcpTool } from "@/lib/mcp-business-tools";
import { SUPPLIER_ORDER_MCP_TOOLS, runSupplierOrderMcpTool } from "@/lib/mcp-supplier-order-tools";
import { logMcpCall } from "@/lib/mcp-log";
import { handleMcpRequest } from "@/lib/mcp-protocol";
import { bearerAccepted, isMcpConfigured, readSession } from "@/lib/mcp-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const SERVER_VERSION = "1.2.0";

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

  const business = session.scope === "business";
  if (business) {
    if (!session.credentialId) return rpcError(401, -32001, "Reconnect ChatGPT from Volteira Settings > Integrations");
    const { data: credential } = await database
      .from("mcp_business_credentials")
      .select("id")
      .eq("id", session.credentialId)
      .eq("organization_id", session.organizationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString())
      .maybeSingle();
    if (!credential) return rpcError(401, -32001, "This ChatGPT connection has been revoked or expired");
    void database.from("mcp_business_credentials").update({ last_used_at: new Date().toISOString() }).eq("id", session.credentialId);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, "Parse error: invalid JSON");
  }

  const tools = business ? [...BUSINESS_MCP_TOOLS, ...SUPPLIER_ORDER_MCP_TOOLS, ...BOOKING_TOOLS] : BOOKING_TOOLS;
  const businessNames = new Set(BUSINESS_MCP_TOOLS.map((tool) => tool.name));
  const supplierNames = new Set(SUPPLIER_ORDER_MCP_TOOLS.map((tool) => tool.name));

  const reply = await handleMcpRequest(body, {
    serverInfo: { name: business ? "electrician-business" : "electrician-booking", version: SERVER_VERSION },
    tools,
    callTool: async (name, args) => {
      const toolStartedAt = Date.now();
      const result = business && businessNames.has(name)
        ? await runBusinessMcpTool({ database, session, name, args })
        : business && supplierNames.has(name)
          ? await runSupplierOrderMcpTool({ database, session, name, args })
          : await runBookingTool({ database, session, name, args });
      await logMcpCall(database, {
        organizationId: session.organizationId,
        method: "tools/call",
        toolName: name,
        arguments: args,
        resultText: result.text,
        isError: result.isError === true,
        durationMs: Date.now() - toolStartedAt,
      });
      return result;
    },
  });

  const described = describeRequest(body);
  if (described.method !== "tools/call") {
    await logMcpCall(database, { organizationId: session.organizationId, method: described.method, httpStatus: reply.status, durationMs: Date.now() - startedAt });
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
