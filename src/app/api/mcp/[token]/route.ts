import { NextResponse } from "next/server";

import { BOOKING_TOOLS, runBookingTool } from "@/lib/booking-tools";
import { handleMcpRequest } from "@/lib/mcp-protocol";
import { bearerAccepted, isMcpConfigured, readSession } from "@/lib/mcp-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The MCP endpoint a realtime voice model calls mid-conversation.
 *
 * One URL per phone call. The token in the path is a signed statement of which
 * business and which caller this connection may act for, minted when the call
 * is answered — so the model can book, but never chooses whose schedule it is
 * booking into.
 *
 * Stateless: no session is issued at initialize, nothing is remembered between
 * requests, and every request carries its own proof. That is what lets this run
 * on the same serverless deployment as the rest of the app rather than needing
 * a process that stays up.
 */

const SERVER_INFO = { name: "electrician-booking", version: "1.0.0" };

function json(body: unknown, status: number) {
  return NextResponse.json(body, { status });
}

function rpcError(status: number, code: number, message: string) {
  return json({ jsonrpc: "2.0", id: null, error: { code, message } }, status);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ token: string }> },
) {
  if (!isMcpConfigured()) {
    return rpcError(503, -32001, "MCP_SESSION_SECRET is not set on this deployment");
  }

  if (!bearerAccepted(request.headers.get("authorization"))) {
    return rpcError(401, -32001, "Unauthorized");
  }

  const { token } = await context.params;
  const session = readSession(token);
  if (!session) {
    // Expired, tampered with, or from another deployment — all the same answer.
    return rpcError(404, -32001, "Session not found");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return rpcError(400, -32700, "Parse error: invalid JSON");
  }

  const reply = await handleMcpRequest(body, {
    serverInfo: SERVER_INFO,
    tools: BOOKING_TOOLS,
    // Built per call rather than per request: handshaking and listing tools are
    // the common case and neither of them touches a database.
    callTool: (name, args) =>
      runBookingTool({ database: getSupabaseAdmin(), session, name, args }),
  });

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
 */
export function GET() {
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
