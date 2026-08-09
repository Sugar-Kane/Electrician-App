import { NextResponse } from "next/server";

import { SENT_OVERWRITABLE_STATUSES } from "@/lib/messaging-rules";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTwilioConfigured, twilioWebhookUrls, verifyTwilioSignature } from "@/lib/twilio";

/**
 * Delivery receipts from Twilio.
 *
 * Without this every outbound message sits at "sent" forever and staff cannot
 * tell a delivered text from one the carrier dropped.
 */

const TRACKED_STATUSES = new Set(["delivered", "failed", "undelivered", "sent"]);

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });

  if (
    !verifyTwilioSignature({
      signature: request.headers.get("x-twilio-signature"),
      url: twilioWebhookUrls(request),
      params,
    })
  ) {
    return new NextResponse(
      isTwilioConfigured() ? "Invalid signature" : "TWILIO_AUTH_TOKEN is not set on this deployment",
      { status: 403 },
    );
  }

  const providerMessageId = params.MessageSid ?? "";
  const status = (params.MessageStatus ?? "").toLowerCase();
  if (!TRACKED_STATUSES.has(status)) return NextResponse.json({ ok: true });

  const database = getSupabaseAdmin();
  const update: Record<string, unknown> = { status };

  if (status === "delivered") update.delivered_at = new Date().toISOString();
  if (status === "failed" || status === "undelivered") {
    update.error_code = params.ErrorCode || null;
    update.error_detail = params.ErrorCode
      ? `Carrier reported error ${params.ErrorCode}.`
      : "The carrier did not deliver this message.";
  }

  // Callbacks are not ordered. A late "sent" must not walk a message back from
  // delivered or failed to looking like it is still in flight.
  const messageId = new URL(request.url).searchParams.get("message");
  let query = database.from("messages").update(update);
  query = messageId
    ? query.eq("id", messageId)
    : providerMessageId
      ? query.eq("provider_message_id", providerMessageId)
      : query.eq("id", "");

  if (status === "sent") query = query.in("status", [...SENT_OVERWRITABLE_STATUSES]);

  await query;

  return NextResponse.json({ ok: true });
}
