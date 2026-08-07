import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { verifyTwilioSignature } from "@/lib/twilio";

/**
 * Delivery receipts from Twilio.
 *
 * Without this every outbound message sits at "sent" forever and staff cannot
 * tell a delivered text from one the carrier dropped.
 */

const TERMINAL_STATUSES = new Set(["delivered", "failed", "undelivered", "sent"]);

function requestUrl(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "");
  if (configured) return `${configured}/api/twilio/status`;
  return request.url;
}

export async function POST(request: Request) {
  const formData = await request.formData();
  const params: Record<string, string> = {};
  formData.forEach((value, key) => {
    params[key] = typeof value === "string" ? value : "";
  });

  if (
    !verifyTwilioSignature({
      signature: request.headers.get("x-twilio-signature"),
      url: requestUrl(request),
      params,
    })
  ) {
    return new NextResponse("Invalid signature", { status: 403 });
  }

  const providerMessageId = params.MessageSid ?? "";
  const status = (params.MessageStatus ?? "").toLowerCase();
  if (!providerMessageId || !TERMINAL_STATUSES.has(status)) {
    return NextResponse.json({ ok: true });
  }

  const database = getSupabaseAdmin();
  const update: Record<string, unknown> = { status };

  if (status === "delivered") update.delivered_at = new Date().toISOString();
  if (status === "failed" || status === "undelivered") {
    update.error_code = params.ErrorCode || null;
    update.error_detail = params.ErrorCode
      ? `Carrier reported error ${params.ErrorCode}.`
      : "The carrier did not deliver this message.";
  }

  await database.from("messages").update(update).eq("provider_message_id", providerMessageId);

  return NextResponse.json({ ok: true });
}
