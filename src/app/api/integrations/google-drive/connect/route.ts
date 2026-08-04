import { cookies } from "next/headers";

import { createDocumentOAuthState } from "@/lib/document-secrets";
import { buildGoogleDriveAuthorizationUrl } from "@/lib/google-drive";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  try {
    return new URL(configured || request.url).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

export async function GET(request: Request) {
  const organizationId = new URL(request.url).searchParams.get("organization_id") ?? "";
  const origin = appOrigin(request);

  if (!UUID_PATTERN.test(organizationId)) {
    return Response.redirect(`${origin}/files?setup=organization`);
  }
  if (
    !process.env.GOOGLE_DRIVE_CLIENT_ID ||
    !process.env.GOOGLE_DRIVE_CLIENT_SECRET ||
    !process.env.DOCUMENT_SYNC_ENCRYPTION_KEY ||
    !process.env.SUPABASE_SECRET_KEY
  ) {
    return Response.redirect(`${origin}/files?setup=google`);
  }

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user) return Response.redirect(`${origin}/login?next=/files`);

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", organizationId)
    .eq("user_id", authData.user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();

  if (!membership) return Response.redirect(`${origin}/files?setup=permission`);

  const state = createDocumentOAuthState(organizationId, authData.user.id);
  const cookieStore = await cookies();
  cookieStore.set("document_google_oauth_state", state, {
    httpOnly: true,
    secure: origin.startsWith("https://"),
    sameSite: "lax",
    path: "/api/integrations/google-drive",
    maxAge: 15 * 60,
  });

  const redirectUri = `${origin}/api/integrations/google-drive/callback`;
  return Response.redirect(buildGoogleDriveAuthorizationUrl(state, redirectUri));
}
