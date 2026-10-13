import { NextResponse } from "next/server";

import { toE164 } from "@/lib/phone-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  isTwilioConfigured,
  twilioPublicOrigin,
  twilioWebhookUrls,
  verifyTwilioSignature,
} from "@/lib/twilio";
import { xaiSipBridgeTwiml } from "@/lib/twilio-sip";
import { websiteCallbackVoicemail, websiteCallbackVoicemailTwiml } from "@/lib/website-intake";

/**
 * What a call back does once the customer's phone is answered.
 *
 * Twilio asks here the moment the call is picked up, and the call goes to Maya
 * after one short "This call may be recorded." She is presented as a call from
 * the customer so her side can tell who it is. Whether a machine answered is
 * decided in the background and handled by the amd route. The request id in the
 * URL is covered by Twilio's signature, and the call has to be the one placed
 * for that request.
 */

export const runtime = "nodejs";

function twiml(body: string) {
  return new NextResponse(body, {
    headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

const HANG_UP = '<?xml version="1.0" encoding="UTF-8"?><Response><Hangup /></Response>';

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

  const requestId = new URL(request.url).searchParams.get("request") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) return twiml(HANG_UP);

  const database = getSupabaseAdmin();
  const { data: row } = await database
    .from("booking_requests")
    .select("id, organization_id, first_name, phone, callback_call_sid")
    .eq("id", requestId)
    .maybeSingle();
  if (!row || row.callback_call_sid !== params.CallSid) return twiml(HANG_UP);

  const { data: organization } = await database
    .from("organizations")
    .select("name, phone")
    .eq("id", String(row.organization_id))
    .maybeSingle();
  const businessName = String(organization?.name ?? "");
  const businessPhone = toE164(String(organization?.phone ?? ""));
  const customerPhone = toE164(String(row.phone ?? ""));

  // Only when Twilio was asked to decide before answering; a call placed with
  // background detection never arrives here with a verdict.
  const answeredBy = params.AnsweredBy ?? "";
  if (/^(machine|fax)/.test(answeredBy)) {
    // The outcome is written when the call ends, by the status callback.
    return twiml(
      websiteCallbackVoicemailTwiml(
        websiteCallbackVoicemail({
          businessName,
          firstName: String(row.first_name ?? ""),
          businessPhone: String(organization?.phone ?? ""),
        }),
      ),
    );
  }

  const bridge = businessPhone && customerPhone
    ? xaiSipBridgeTwiml({
        phone: businessPhone,
        recordingCallbackUrl: `${twilioPublicOrigin(request)}/api/twilio/recording`,
        callerId: customerPhone,
        // One short line, said by us whatever Maya's greeting says, then her.
        briefNotice: true,
      })
    : null;
  if (!bridge) {
    console.error("website call back could not be connected", { requestId });
    return twiml(
      `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna">${escapeXml(
        `Sorry, this is ${businessName || "the electrician"} returning your request. We'll call you back shortly.`,
      )}</Say><Hangup /></Response>`,
    );
  }

  // Answered by a person: this is what tells Maya's side the call is a call back.
  await database
    .from("booking_requests")
    .update({ callback_outcome: "answered" })
    .eq("id", requestId)
    .eq("callback_outcome", "calling");

  return twiml(bridge);
}
