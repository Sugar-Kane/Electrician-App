import { cookies } from "next/headers";

import { ensureDocumentsBucket } from "@/lib/document-storage";
import { encryptDocumentSecret, readDocumentOAuthState } from "@/lib/document-secrets";
import {
  createGoogleDriveWorkspaceRoot,
  createMissingGoogleDriveFolders,
  exchangeGoogleDriveCode,
  getGoogleAccountEmail,
  type DriveFolderLink,
  type DriveFolderRow,
} from "@/lib/google-drive";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

function appOrigin(request: Request) {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  try {
    return new URL(configured || request.url).origin;
  } catch {
    return new URL(request.url).origin;
  }
}

function filesRedirect(origin: string, key: string, value: string) {
  const target = new URL("/files", origin);
  target.searchParams.set(key, value);
  return Response.redirect(target);
}

export async function GET(request: Request) {
  const origin = appOrigin(request);
  const requestUrl = new URL(request.url);
  const code = requestUrl.searchParams.get("code") ?? "";
  const returnedState = requestUrl.searchParams.get("state") ?? "";
  const providerError = requestUrl.searchParams.get("error");
  const cookieStore = await cookies();
  const stateCookie = cookieStore.get("document_google_oauth_state")?.value ?? "";
  cookieStore.delete("document_google_oauth_state");

  if (providerError) return filesRedirect(origin, "drive", "canceled");
  if (!code || !returnedState || returnedState !== stateCookie) {
    return filesRedirect(origin, "drive", "invalid_state");
  }

  const oauthState = readDocumentOAuthState(returnedState);
  if (!oauthState) return filesRedirect(origin, "drive", "expired");

  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();
  if (!authData.user || authData.user.id !== oauthState.userId) {
    return Response.redirect(`${origin}/login?next=/files`);
  }

  const { data: membership } = await supabase
    .from("organization_members")
    .select("role")
    .eq("organization_id", oauthState.organizationId)
    .eq("user_id", authData.user.id)
    .in("role", ["owner", "admin"])
    .maybeSingle();
  if (!membership) return filesRedirect(origin, "drive", "permission");

  const redirectUri = `${origin}/api/integrations/google-drive/callback`;
  const admin = getSupabaseAdmin();
  let integrationId: string | null = null;

  try {
    const tokens = await exchangeGoogleDriveCode(code, redirectUri);
    if (!tokens.refresh_token) throw new Error("Google did not return offline access.");
    const accountEmail = await getGoogleAccountEmail(tokens.access_token);

    const [organizationResult, foldersResult, existingIntegrationResult] = await Promise.all([
      admin
        .from("organizations")
        .select("name")
        .eq("id", oauthState.organizationId)
        .single(),
      admin
        .from("document_folders")
        .select("id,parent_folder_id,folder_key,display_name,sort_order")
        .eq("organization_id", oauthState.organizationId),
      admin
        .from("document_integrations")
        .select("id,root_external_id,root_external_url")
        .eq("organization_id", oauthState.organizationId)
        .eq("provider", "google_drive")
        .maybeSingle(),
    ]);

    if (organizationResult.error || foldersResult.error) {
      throw new Error("The document workspace is not ready.");
    }

    const existingIntegration = existingIntegrationResult.data as {
      id: string;
      root_external_id: string | null;
      root_external_url: string | null;
    } | null;

    const integrationResult = await admin
      .from("document_integrations")
      .upsert(
        {
          organization_id: oauthState.organizationId,
          provider: "google_drive",
          status: "connecting",
          sync_mode: "mirror_to_cloud",
          external_account_email: accountEmail,
          requested_by: authData.user.id,
          last_error: null,
        },
        { onConflict: "organization_id,provider" },
      )
      .select("id")
      .single();

    if (integrationResult.error || !integrationResult.data) {
      throw new Error("The Google Drive connection could not be saved.");
    }
    integrationId = integrationResult.data.id as string;

    const folders = (foldersResult.data ?? []) as DriveFolderRow[];
    const rootFolder = folders.find((folder) => folder.folder_key === "root");
    if (!rootFolder) throw new Error("The document root folder is missing.");

    let rootExternalId = existingIntegration?.root_external_id ?? null;
    let rootExternalUrl = existingIntegration?.root_external_url ?? null;
    if (!rootExternalId) {
      const root = await createGoogleDriveWorkspaceRoot(
        tokens.access_token,
        organizationResult.data.name as string,
      );
      rootExternalId = root.id;
      rootExternalUrl = root.webViewLink ?? null;
    }

    const existingLinksResult = await admin
      .from("document_cloud_links")
      .select("folder_id,external_object_id,external_parent_id,external_web_url")
      .eq("integration_id", integrationId)
      .not("folder_id", "is", null);
    if (existingLinksResult.error) throw new Error("Existing Drive folders could not be checked.");

    const existingLinks = (existingLinksResult.data ?? []).map((link) => ({
      localFolderId: link.folder_id as string,
      externalId: link.external_object_id as string,
      externalParentId: (link.external_parent_id as string | null) ?? null,
      webUrl: (link.external_web_url as string | null) ?? null,
    })) satisfies DriveFolderLink[];

    const rootLink: DriveFolderLink = {
      localFolderId: rootFolder.id,
      externalId: rootExternalId,
      externalParentId: null,
      webUrl: rootExternalUrl,
    };
    const linksWithoutRoot = existingLinks.filter(
      (link) => link.localFolderId !== rootFolder.id,
    );

    await admin.from("document_cloud_links").upsert(
      {
        organization_id: oauthState.organizationId,
        integration_id: integrationId,
        folder_id: rootFolder.id,
        document_id: null,
        external_object_id: rootExternalId,
        external_parent_id: null,
        external_web_url: rootExternalUrl,
        sync_status: "synced",
        last_error: null,
        last_synced_at: new Date().toISOString(),
      },
      { onConflict: "integration_id,folder_id" },
    );

    const createdLinks = await createMissingGoogleDriveFolders({
      accessToken: tokens.access_token,
      folders: folders.filter((folder) => folder.id !== rootFolder.id),
      existingLinks: [rootLink, ...linksWithoutRoot],
    });

    if (createdLinks.length > 0) {
      const cloudLinksResult = await admin.from("document_cloud_links").upsert(
        createdLinks.map((link) => ({
          organization_id: oauthState.organizationId,
          integration_id: integrationId,
          folder_id: link.localFolderId,
          document_id: null,
          external_object_id: link.externalId,
          external_parent_id: link.externalParentId,
          external_web_url: link.webUrl,
          sync_status: "synced",
          last_error: null,
          last_synced_at: new Date().toISOString(),
        })),
        { onConflict: "integration_id,folder_id" },
      );
      if (cloudLinksResult.error) throw new Error("Drive folder links could not be saved.");
    }

    const credentialResult = await admin.rpc("store_document_provider_credential", {
      p_integration_id: integrationId,
      p_encrypted_refresh_token: encryptDocumentSecret(tokens.refresh_token),
      p_scopes: (tokens.scope ?? "").split(/\s+/).filter(Boolean),
    });
    if (credentialResult.error) throw new Error("The Drive connection could not be secured.");

    await ensureDocumentsBucket();

    const updateResult = await admin
      .from("document_integrations")
      .update({
        status: "connected",
        root_external_id: rootExternalId,
        root_external_url: rootExternalUrl,
        external_account_email: accountEmail,
        last_error: null,
        last_synced_at: new Date().toISOString(),
      })
      .eq("id", integrationId);
    if (updateResult.error) throw new Error("The Drive connection could not be finalized.");

    return filesRedirect(origin, "connected", "google_drive");
  } catch {
    if (integrationId) {
      await admin
        .from("document_integrations")
        .update({ status: "error", last_error: "Google Drive setup did not finish." })
        .eq("id", integrationId);
    }
    return filesRedirect(origin, "drive", "setup_failed");
  }
}
