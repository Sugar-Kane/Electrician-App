import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { fetchTwilioRecordingMedia } from "@/lib/twilio";
import { TWILIO_RECORDING_SID_PATTERN } from "@/lib/twilio-recording";

export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: { params: Promise<{ recordingSid: string }> },
) {
  const { recordingSid } = await context.params;
  if (!TWILIO_RECORDING_SID_PATTERN.test(recordingSid)) {
    return new Response("Not found", { status: 404 });
  }

  const supabase = asFlexibleClient(await createClient());
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return new Response("Unauthorized", { status: 401 });

  // RLS restricts this lookup to calls belonging to one of the signed-in
  // user's organizations. A guessed RecordingSid therefore reveals nothing.
  const { data: call } = await supabase
    .from("inbound_calls")
    .select("id")
    .eq("recording_sid", recordingSid)
    .maybeSingle();
  if (!call) return new Response("Not found", { status: 404 });

  const media = await fetchTwilioRecordingMedia({
    recordingSid,
    range: request.headers.get("range"),
  });
  if (!media) return new Response("Recording service unavailable", { status: 503 });
  if (!media.ok && media.status !== 206) {
    return new Response(media.status === 404 ? "Not found" : "Could not load recording", {
      status: media.status === 404 ? 404 : 502,
    });
  }

  const headers = new Headers({
    "Content-Type": media.headers.get("content-type") ?? "audio/mpeg",
    "Cache-Control": "private, no-store",
    "Content-Disposition": `inline; filename="${recordingSid}.mp3"`,
  });
  for (const name of ["content-length", "content-range", "accept-ranges"]) {
    const value = media.headers.get(name);
    if (value) headers.set(name, value);
  }

  return new Response(media.body, { status: media.status, headers });
}
