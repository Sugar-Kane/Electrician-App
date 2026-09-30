import { cookies } from "next/headers";
import { currentContext } from "@/lib/request-context";
import { createDocumentOAuthState } from "@/lib/document-secrets";
import { calendarConfig, CALENDAR_SCOPE } from "@/lib/google-booking-calendar";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

export async function GET() {
  const context = await currentContext();
  if (!context || !["owner", "admin"].includes(context.role)) return new Response("Owner sign-in required", { status: 403 });
  const config = calendarConfig();
  if (!config) return new Response("Google Calendar OAuth must be configured on the server before connecting.", { status: 503 });
  const { data } = await getSupabaseAdmin().from("booking_calendar_connections").select("account_email").eq("organization_id", context.organizationId).maybeSingle();
  if (!data?.account_email) return Response.redirect(`${config.origin}/settings/integrations`);
  const state = createDocumentOAuthState(context.organizationId, context.userId);
  (await cookies()).set("booking_calendar_state", state, { httpOnly: true, secure: true, sameSite: "lax", maxAge: 900, path: "/api/integrations/google-calendar" });
  const query = new URLSearchParams({ client_id: config.clientId, redirect_uri: `${config.origin}/api/integrations/google-calendar/callback`, response_type: "code", access_type: "offline", prompt: "consent", scope: `openid email ${CALENDAR_SCOPE}`, state, login_hint: String(data.account_email) });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${query}`);
}
