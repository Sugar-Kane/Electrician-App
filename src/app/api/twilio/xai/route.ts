import { NextResponse } from "next/server";

import {
  isTwilioConfigured,
  twilioPublicOrigin,
  twilioWebhookUrls,
  verifyTwilioSignature,
} from "@/lib/twilio";
import { xaiSipBridgeTwiml } from "@/lib/twilio-sip";

export const runtime = "nodejs";

function twiml(body: string, status: number = 200) {
  return new NextResponse(body, {
    status,
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
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

  const origin = twilioPublicOrigin(request);
  const body = xaiSipBridgeTwiml({
    phone: params.To ?? "",
    recordingCallbackUrl: `${origin}/api/twilio/recording`,
  });

  if (!body) {
    return twiml(
      '<?xml version="1.0" encoding="UTF-8"?><Response><Say>Sorry, this number is not configured.</Say><Hangup /></Response>',
      400,
    );
  }

  return twiml(body);
}
