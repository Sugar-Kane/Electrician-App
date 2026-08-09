import { NextResponse } from "next/server";

import { BOOKING_TOOLS, runBookingTool } from "@/lib/booking-tools";
import { logMcpCall } from "@/lib/mcp-log";
import { handleMcpRequest } from "@/lib/mcp-protocol";
import { bearerAccepted, isMcpConfigured, readSession } from "@/lib/mcp-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The MCP endpoint a realtime voice model calls mid-conversation.
 *
 * The token in the path is a signed statement of which business this connection
 * may act for. The model can call the tools; it cannot say whose schedule it is
 * writing to.
 *
 * Stateless: no session is issued at initialize, nothing is remembered between
 * requests, and every request carries its own proof. That is what lets this run
 * on the same serverless deployment as the rest of the app.
 *
 * Every request is logged to `mcp_call_log`, including the ones that are turned
 * away here. The tools are quiet by design — a refusal writes nothing, and
 * listing slots writes nothing — so without this a call that went wrong would
 * leave no evidence at all. It did, once, which is why this exists.
 */

const SERVER_INFO = { name: "electrician-booking", version: "1.0.0" };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

function rpcError(status: number, code: number, message: string) {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);
}

/** What arrived, for the log, without assuming the body is well formed. */
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
    // Expired, tampered with, or from another deployment — all the same answer
    // to the caller, but worth being able to see from the inside.
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

  const reply = await handleMcpRequest(body, {
    serverInfo: SERVER_INFO,
    tools: BOOKING_TOOLS,
    // Built per call rather than per request: handshaking and listing tools are
    // the common case and neither of them touches a database.
    callTool: async (name, args) => {
      const toolStartedAt = Date.now();
      const result = await runBookingTool({ database, session, name, args });
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

  // Handshake and listing traffic, so "did it ever connect?" is answerable.
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

/**
 * No server-initiated stream.
 *
 * The transport allows a client to open one with GET for messages the server
 * wants to push. This server never pushes: it only answers, so declining is
 * the honest response rather than holding a connection open that will stay
 * silent.
 *
 * Logged, because a client that only speaks the older SSE transport would show
 * up here and nowhere else — and that would look identical to never connecting.
 */
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
