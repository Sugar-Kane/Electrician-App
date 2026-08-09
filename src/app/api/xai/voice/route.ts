import { NextResponse } from "next/server";

import { BOOKING_TOOL_NAMES } from "@/lib/booking-tool-rules";
import { buildSessionUpdate, realtimeUrlForCall } from "@/lib/grok-voice";
import {
  findOrCreateCustomerByPhone,
  loadIntakeContext,
  organizationForPhoneNumber,
} from "@/lib/intake-shared";
import { isMcpConfigured, mcpSessionUrl } from "@/lib/mcp-session";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { twilioPublicOrigin } from "@/lib/twilio";
import { readIncomingCall, verifyXaiWebhook } from "@/lib/xai-webhook";

/**
 * A call arriving on the SIP trunk.
 *
 * xAI answers the phone and bridges the audio; what it needs from us is the
 * configuration for the session — who this business is, what it may offer, and
 * the URL of the booking tools. This works out all of that and hands it back.
 *
 * It does not open the WebSocket. That connection has to stay up for the length
 * of a phone call, which a serverless function cannot do, so it belongs to the
 * worker in scripts/. Everything the worker needs is decided here, where the
 * tenant rules live and are tested, and the worker stays a pipe.
 */

export async function POST(request: Request) {
  const secret = process.env.XAI_WEBHOOK_SECRET ?? "";
  // Read raw: a re-serialised body will not match the signature.
  const body = await request.text();

  if (
    !verifyXaiWebhook({
      secret,
      headers: {
        id: request.headers.get("webhook-id"),
        timestamp: request.headers.get("webhook-timestamp"),
        signature: request.headers.get("webhook-signature"),
      },
      body,
    })
  ) {
    // Says which of the two causes it is, rather than leaving someone to guess
    // from a deliveries log at midnight.
    return new NextResponse(
      secret ? "Invalid signature" : "XAI_WEBHOOK_SECRET is not set on this deployment",
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const call = readIncomingCall(payload);
  // Any other event is acknowledged rather than refused: a 4xx invites retries
  // for something that will never become interesting.
  if (!call) return NextResponse.json({ ignored: true });

  if (!isMcpConfigured()) {
    return NextResponse.json({ error: "MCP_SESSION_SECRET is not set" }, { status: 503 });
  }

  const database = getSupabaseAdmin();

  const organizationId = await organizationForPhoneNumber(database, call.to);
  if (!organizationId) {
    return NextResponse.json({ error: "No organization owns this number" }, { status: 404 });
  }

  const customerId = await findOrCreateCustomerByPhone({
    database,
    organizationId,
    phone: call.from,
    note: "Created from an inbound phone call.",
  });
  if (!customerId) {
    return NextResponse.json({ error: "Could not open a customer record" }, { status: 500 });
  }

  const { context } = await loadIntakeContext({ database, organizationId, isFirstReply: false });

  // Keyed by call_id the same way a Twilio call is keyed by CallSid: one row
  // per call, so the transcript and any booking hang off something addressable.
  await database.from("voice_calls").upsert(
    {
      organization_id: organizationId,
      customer_id: customerId,
      call_sid: call.callId,
      from_number: call.from,
      to_number: call.to,
      status: "in_progress",
      turns: [],
    },
    { onConflict: "call_sid" },
  );

  const mcpServerUrl = mcpSessionUrl({
    origin: twilioPublicOrigin(request),
    session: { organizationId, customerId, phone: call.from },
  });
  if (!mcpServerUrl) {
    return NextResponse.json({ error: "Could not mint a booking URL" }, { status: 503 });
  }

  return NextResponse.json({
    callId: call.callId,
    realtimeUrl: realtimeUrlForCall(call.callId),
    sessionUpdate: buildSessionUpdate({
      context,
      mcpServerUrl,
      allowedTools: BOOKING_TOOL_NAMES,
      bearerToken: process.env.MCP_BEARER_TOKEN || undefined,
    }),
  });
}
