import { NextResponse } from "next/server";

import { organizationForPhoneNumber } from "@/lib/intake-shared";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import {
  fetchTwilioCall,
  isTwilioConfigured,
  matchesTwilioAccountSid,
  twilioWebhookUrls,
  verifyTwilioSignature,
} from "@/lib/twilio";
import { readTwilioRecordingEvent } from "@/lib/twilio-recording";

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
      isTwilioConfigured()
        ? "Invalid signature"
        : "TWILIO_AUTH_TOKEN is not set on this deployment",
      { status: 403 },
    );
  }

  const recording = readTwilioRecordingEvent(params);
  if (!recording || !matchesTwilioAccountSid(recording.accountSid)) {
    return new NextResponse("Invalid recording callback", { status: 400 });
  }

  const call = await fetchTwilioCall(recording.callSid);
  if (!call?.from || !call.to) {
    // A non-2xx response asks Twilio to retry rather than losing the only event
    // that says the finished media is available.
    return new NextResponse("Call details are not available yet", { status: 503 });
  }

  const database = getSupabaseAdmin();
  const organizationId = await organizationForPhoneNumber(database, call.to);
  if (!organizationId) {
    return new NextResponse("No organization owns the called number", { status: 404 });
  }

  const { error } = await database.from("inbound_calls").upsert(
    {
      organization_id: organizationId,
      provider: "twilio",
      provider_call_id: recording.callSid,
      from_number: call.from,
      to_number: call.to,
      status: call.status || recording.status,
      started_at: call.startedAt,
      ended_at: call.endedAt,
      duration_seconds: recording.durationSeconds ?? call.durationSeconds,
      recording_sid: recording.recordingSid,
      recording_status: recording.status,
      recording_channels: recording.channels,
      recording_started_at: recording.startedAt,
      // The authenticated playback route constructs the provider URL. Keeping
      // it out of the table prevents an otherwise harmless SELECT from
      // becoming a reusable direct media link.
      recording_url: null,
    },
    { onConflict: "provider,provider_call_id" },
  );

  if (error) return new NextResponse("Could not save recording", { status: 500 });
  return NextResponse.json({ ok: true });
}
