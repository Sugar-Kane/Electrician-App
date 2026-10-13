import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { isTwilioConfigured, twilioWebhookUrls, verifyTwilioSignature } from "@/lib/twilio";
import { finishWebsiteCallback } from "@/lib/website-callback-finish";
import { callbackOutcomeFor } from "@/lib/website-intake";

/**
 * How a call back ended. Settled once, by `finishWebsiteCallback`: a machine
 * verdict that arrived first has already settled a voicemail.
 */

export const runtime = "nodejs";

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

  const outcome = callbackOutcomeFor({ callStatus: params.CallStatus ?? "", answeredBy: params.AnsweredBy ?? "" });
  const callSid = params.CallSid ?? "";
  if (!outcome || !/^CA[0-9a-f]{32}$/.test(callSid)) return NextResponse.json({ ignored: true });

  const settled = await finishWebsiteCallback({ database: getSupabaseAdmin(), callSid, outcome });
  if (!settled) return NextResponse.json({ ok: true, repeat: true });

  return NextResponse.json({ ok: true, outcome });
}
