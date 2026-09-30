import { cookies } from "next/headers";
import { currentContext } from "@/lib/request-context";
import { encryptDocumentSecret, readDocumentOAuthState } from "@/lib/document-secrets";
import { calendarConfig, CALENDAR_SCOPE, syncUpcomingPaidBookings } from "@/lib/google-booking-calendar";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const config = calendarConfig();
  if (!config) return new Response("Calendar setup missing", { status: 503 });
  const query = new URL(request.url).searchParams;
  const cookieStore = await cookies();
  const cookie = cookieStore.get("booking_calendar_state")?.value;
  cookieStore.set("booking_calendar_state", "", { maxAge: 0, path: "/api/integrations/google-calendar" });
  const raw = query.get("state") ?? "";
  const state = readDocumentOAuthState(raw);
  const context = await currentContext();
  if (!cookie || cookie !== raw || !state || !context || state.userId !== context.userId || state.organizationId !== context.organizationId || !["owner", "admin"].includes(context.role)) return new Response("Invalid authorization session", { status: 403 });
  if (query.has("error")) return Response.redirect(`${config.origin}/settings/integrations?calendar=canceled`);
  const code = query.get("code");
  if (!code) return new Response("Missing authorization code", { status: 400 });
  const db = getSupabaseAdmin();
  try {
    const { data: expected } = await db.from("booking_calendar_connections").select("account_email").eq("organization_id", context.organizationId).single();
    const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ code, client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: `${config.origin}/api/integrations/google-calendar/callback`, grant_type: "authorization_code" }), signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error("Google authorization failed");
    const tokens = await response.json() as { access_token: string; refresh_token?: string; scope?: string };
    if (!tokens.refresh_token || !tokens.scope?.split(" ").includes(CALENDAR_SCOPE)) throw new Error("Calendar permission was not granted");
    const profileResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { Authorization: `Bearer ${tokens.access_token}` }, signal: AbortSignal.timeout(15000) });
    const profile = profileResponse.ok ? await profileResponse.json() as { email?: string; email_verified?: boolean } : null;
    if (!profile?.email_verified || profile.email?.toLowerCase() !== String(expected?.account_email).toLowerCase()) throw new Error("Sign in with the calendar account saved in settings");
    const { error } = await db.from("booking_calendar_connections").update({ encrypted_refresh_token: encryptDocumentSecret(tokens.refresh_token), connected_at: new Date().toISOString(), last_error: null }).eq("organization_id", context.organizationId);
    if (error) throw new Error("Calendar connection could not be saved");
    await syncUpcomingPaidBookings(context.organizationId);
    return Response.redirect(`${config.origin}/settings/integrations?calendar=connected`);
  } catch (error) {
    await db.from("booking_calendar_connections").update({ last_error: error instanceof Error ? error.message : "Calendar connection failed" }).eq("organization_id", context.organizationId);
    return Response.redirect(`${config.origin}/settings/integrations?calendar=error`);
  }
}
