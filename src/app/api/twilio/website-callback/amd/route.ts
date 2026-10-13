import { NextResponse } from "next/server";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isTwilioConfigured,
  redirectTwilioCall,
  twilioWebhookUrls,
  verifyTwilioSignature,
} from "@/lib/twilio";
import { finishWebsiteCallback } from "@/lib/website-callback-finish";
import { websiteCallbackVoicemail, websiteCallbackVoicemailTwiml } from "@/lib/website-intake";

/**
 * Twilio's verdict on who answered a call back, sent once it knows.
 *
 * The call was put through to Maya the moment it was picked up. When it was a
 * machine, the verdict comes at the end of the greeting, at the beep: the call
 * is taken back from Maya and the voicemail is left instead, and the owner is
 * told nobody was reached. A person, or a verdict Twilio couldn't reach, leaves
 * the call with Maya, and so does a voicemail Twilio wouldn't let us leave. The
 * request id in the URL is covered by Twilio's signature, and the call has to
 * be the one placed for that request.
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

  const callSid = params.CallSid ?? "";
  const requestId = new URL(request.url).searchParams.get("request") ?? "";
  if (!/^CA[0-9a-f]{32}$/.test(callSid) || !/^[0-9a-f-]{36}$/i.test(requestId)) {
    return NextResponse.json({ ignored: true });
  }
  if (!/^(machine|fax)/.test(params.AnsweredBy ?? "")) return NextResponse.json({ ok: true, person: true });

  const database = getSupabaseAdmin();
  const { data: row } = await database
    .from("booking_requests")
    .select("id, organization_id, first_name, callback_call_sid, callback_outcome")
    .eq("id", requestId)
    .maybeSingle();
  if (!row || row.callback_call_sid !== callSid) return NextResponse.json({ ignored: true });
  if (!["calling", "answered"].includes(String(row.callback_outcome))) return NextResponse.json({ ok: true, repeat: true });

  const { data: organization } = await database
    .from("organizations")
    .select("name, phone")
    .eq("id", String(row.organization_id))
    .maybeSingle();
  const redirected = await redirectTwilioCall({
    callSid,
    twiml: websiteCallbackVoicemailTwiml(
      websiteCallbackVoicemail({
        businessName: String(organization?.name ?? ""),
        firstName: String(row.first_name ?? ""),
        businessPhone: String(organization?.phone ?? ""),
      }),
    ),
  });
  if (!redirected.ok) {
    // No voicemail was left (the call may already have ended): the call's own
    // final status settles it, rather than telling the owner it was.
    console.error("call back voicemail could not be left", { requestId, error: redirected.errorCode });
    return NextResponse.json({ ok: true, voicemail: false });
  }

  await finishWebsiteCallback({ database, callSid, outcome: "voicemail" });
  return NextResponse.json({ ok: true, voicemail: true });
}
