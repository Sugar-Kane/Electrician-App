import { NextResponse } from "next/server";

import { recordActivity } from "@/lib/activity";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isTwilioConfigured,
  twilioWebhookUrls,
  verifyTwilioSignature,
} from "@/lib/twilio";
import { missedTransferTwiml, transferCompleted } from "@/lib/twilio-transfer";
import { hangupTwiml } from "@/lib/voice-intake";

export const runtime = "nodejs";

function twiml(body: string, status: number = 200) {
  return new NextResponse(body, {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
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
      url: twilioWebhookUrls(request),
      params,
    })
  ) {
    return new NextResponse(
      isTwilioConfigured()
        ? "Invalid signature"
        : "TWILIO_AUTH_TOKEN is not set on this deployment",
      { status: 403 },
    );
  }

  const url = new URL(request.url);
  const callSid = url.searchParams.get("call") ?? "";
  const requestId = url.searchParams.get("request") ?? "";
  const language = url.searchParams.get("lang") === "es" ? "es" : "en";
  if (
    !/^CA[a-f0-9]{32}$/i.test(callSid) ||
    params.CallSid !== callSid ||
    !requestId
  ) {
    return new NextResponse("Invalid transfer callback", { status: 400 });
  }

  const database = getSupabaseAdmin();
  const { data: booking } = await database
    .from("booking_requests")
    .select("id, organization_id, customer_id")
    .eq("id", requestId)
    .maybeSingle();
  if (!booking)
    return new NextResponse("Unknown booking request", { status: 404 });

  const row = booking as Record<string, unknown>;
  const organizationId =
    typeof row.organization_id === "string" ? row.organization_id : "";
  const customerId =
    typeof row.customer_id === "string" ? row.customer_id : null;
  if (!organizationId)
    return new NextResponse("Invalid booking request", { status: 400 });

  const connected = transferCompleted(params.DialCallStatus ?? "");
  await database
    .from("inbound_calls")
    .update({
      status: connected ? "transfer_connected" : "transfer_missed",
      ended_reason: connected
        ? "transferred_to_electrician"
        : params.DialCallStatus || "no-answer",
    })
    .eq("provider", "twilio")
    .eq("provider_call_id", callSid)
    .eq("organization_id", organizationId);

  await recordActivity(database, {
    organizationId,
    eventType: connected
      ? "booking.transfer_connected"
      : "booking.transfer_missed",
    label: connected
      ? "Caller connected to electrician"
      : "Electrician missed live transfer",
    customerId,
    bookingRequestId: requestId,
    metadata: {
      provider_call_id: callSid,
      dial_status: params.DialCallStatus ?? "",
    },
  });

  return connected
    ? twiml(
        hangupTwiml(language === "es" ? "Gracias." : "Thank you.", language),
      )
    : twiml(missedTransferTwiml(language));
}
