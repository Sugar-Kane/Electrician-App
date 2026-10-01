import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { PHOTO_TYPES, readMessagePhotos } from "@/lib/message-media";

export async function GET(_request: Request, { params }: { params: Promise<{ messageId: string; index: string }> }) {
  const context = await currentContext();
  if (!context) return new Response("Sign in required", { status: 401 });
  const { messageId, index } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(messageId) || !/^[0-9]$/.test(index)) return new Response("Not found", { status: 404 });
  const { data } = await getSupabaseAdmin().from("messages").select("media,provider_message_id")
    .eq("organization_id", context.organizationId).eq("id", messageId).maybeSingle();
  const photo = Array.isArray(data?.media) ? data.media[Number(index)] : null;
  if (!photo || typeof photo.url !== "string") return new Response("Not found", { status: 404 });
  const account = photo.url.match(/\/Accounts\/(AC[0-9a-f]{32})\//i)?.[1] ?? "";
  const validated = readMessagePhotos({ AccountSid: account, MessageSid: String(data?.provider_message_id ?? ""), NumMedia: "1", MediaUrl0: photo.url, MediaContentType0: photo.contentType });
  if (!validated.length) return new Response("Not found", { status: 404 });
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  if (!sid || !token) return new Response("Photo unavailable", { status: 503 });
  try {
    const response = await fetch(photo.url, { headers: { Authorization: `Basic ${Buffer.from(`${sid}:${token}`).toString("base64")}` }, cache: "no-store", signal: AbortSignal.timeout(15000) });
    const contentType = response.headers.get("content-type")?.split(";")[0] ?? "";
    if (!response.ok || !PHOTO_TYPES.has(contentType)) return new Response("Photo unavailable", { status: 502 });
    return new Response(response.body, { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": "inline" } });
  } catch { return new Response("Photo unavailable", { status: 502 }); }
}
