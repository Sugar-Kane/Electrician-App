import { NextResponse } from "next/server";

import { BOOKING_TOOLS, runBookingTool } from "@/lib/booking-tools";
import { BUSINESS_MCP_TOOLS, runBusinessMcpTool } from "@/lib/mcp-business-tools";
import { logMcpCall } from "@/lib/mcp-log";
import { handleMcpRequest } from "@/lib/mcp-protocol";
import { bearerAccepted, isMcpConfigured, readSession } from "@/lib/mcp-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * One MCP endpoint, with two signed privilege levels.
 *
 * `booking` is the public-facing receptionist surface: intake, slots, booking
 * and callback only. `business` is the owner's ChatGPT surface: customers,
 * reports, hours, estimates, invoices, texts, contracts and supplier status.
 * The scope comes from the signed URL and is never accepted as a tool argument.
 */

const SERVER_VERSION = "1.1.0";

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
  const params = typeof record.params === "object" && record.params !== null
    ? (record.params as Record<string, unknown>)
    : {};
  const toolName = typeof params.name === "string" ? params.name : undefined;

  return { method, toolName };
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  const startedAt = Date.now();

  if (!isMcpConfigured()) {
    return rpcError(503, -32001, "MCP_SESSION_SECRET is not set on this deployment");
  }

  if (!bearerAccepted(request.headers.get("authorization"))) {
    return rpcError(401, -32001, "Unauthorized");
  }

  const { token } = await context.params;
  const session = readSession(token);
  const database = getSupabaseAdmin();

  if (!session) {
    await logMcpCall(database, {
      organizationId: null,
      method: "rejected",
      resultText: "Session not found: the token did not verify.",
      isError: true,
      httpStatus: 404,
      durationMs: Date.now() - startedAt,
    });
    return rpcError(404, -32001, "Session not found");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    await logMcpCall(database, {
      organizationId: session.organizationId,
      method: "unparseable",
      resultText: "Parse error: invalid JSON",
      isError: true,
      httpStatus: 400,
      durationMs: Date.now() - startedAt,
    });
    return rpcError(400, -32700, "Parse error: invalid JSON");
  }

  const business = session.scope === "business";
  const tools = business ? BUSINESS_MCP_TOOLS : BOOKING_TOOLS;
  const serverInfo = {
    name: business ? "electrician-business" : "electrician-booking",
    version: SERVER_VERSION,
  };

  const reply = await handleMcpRequest(body, {
    serverInfo,
    tools,
    callTool: async (name, args) => {
      const toolStartedAt = Date.now();
      const result = business
        ? await runBusinessMcpTool({ database, session, name, args })
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
    await logMcpCall(database, {
      organizationId: session.organizationId,
      method: described.method,
      httpStatus: reply.status,
      durationMs: Date.now() - startedAt,
    });
  }

  if (reply.body === undefined) return new NextResponse(null, { status: reply.status });
  return json(reply.body, reply.status);
}

export async function GET() {
  await logMcpCall(getSupabaseAdmin(), {
    organizationId: null,
    method: "GET",
    resultText: "A client tried to open a server-sent event stream.",
    isError: true,
    httpStatus: 405,
  });

  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}

export function DELETE() {
  return new NextResponse("Method Not Allowed", {
    status: 405,
    headers: { Allow: "POST" },
  });
}
