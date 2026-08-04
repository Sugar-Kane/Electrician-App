import "server-only";

export const GOOGLE_DRIVE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/drive.file",
];

type GoogleTokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type: string;
  id_token?: string;
};

export type DriveFolderRow = {
  id: string;
  parent_folder_id: string | null;
  folder_key: string;
  display_name: string;
  sort_order: number;
};

export type DriveFolderLink = {
  localFolderId: string;
  externalId: string;
  externalParentId: string | null;
  webUrl: string | null;
};

function getGoogleConfiguration() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("Google Drive OAuth is not configured.");
  }
  return { clientId, clientSecret };
}

export function buildGoogleDriveAuthorizationUrl(state: string, redirectUri: string) {
  const { clientId } = getGoogleConfiguration();
  const parameters = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    scope: GOOGLE_DRIVE_SCOPES.join(" "),
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${parameters.toString()}`;
}

export async function exchangeGoogleDriveCode(code: string, redirectUri: string) {
  const { clientId, clientSecret } = getGoogleConfiguration();
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: "authorization_code",
    }),
    cache: "no-store",
  });

  if (!response.ok) throw new Error("Google Drive authorization failed.");
  return (await response.json()) as GoogleTokenResponse;
}

export async function getGoogleAccountEmail(accessToken: string) {
  const response = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  if (!response.ok) return null;
  const profile = (await response.json()) as { email?: string };
  return profile.email ?? null;
}

async function createGoogleDriveFolder(
  accessToken: string,
  name: string,
  parentId?: string,
) {
  const response = await fetch(
    "https://www.googleapis.com/drive/v3/files?fields=id,name,webViewLink",
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        name,
        mimeType: "application/vnd.google-apps.folder",
        ...(parentId ? { parents: [parentId] } : {}),
      }),
      cache: "no-store",
    },
  );

  if (!response.ok) throw new Error("A Google Drive folder could not be created.");
  return (await response.json()) as { id: string; name: string; webViewLink?: string };
}

export async function createGoogleDriveWorkspaceRoot(
  accessToken: string,
  businessName: string,
) {
  return createGoogleDriveFolder(accessToken, `${businessName} – Electrician App`);
}

export async function createMissingGoogleDriveFolders(input: {
  accessToken: string;
  folders: DriveFolderRow[];
  existingLinks: DriveFolderLink[];
}) {
  const links = new Map(input.existingLinks.map((link) => [link.localFolderId, link]));
  const pending = input.folders
    .filter((folder) => !links.has(folder.id))
    .sort((left, right) => left.sort_order - right.sort_order || left.display_name.localeCompare(right.display_name));
  const created: DriveFolderLink[] = [];

  while (pending.length > 0) {
    let madeProgress = false;

    for (let index = pending.length - 1; index >= 0; index -= 1) {
      const folder = pending[index];
      if (!folder.parent_folder_id) continue;
      const parentLink = links.get(folder.parent_folder_id);
      if (!parentLink) continue;

      const external = await createGoogleDriveFolder(
        input.accessToken,
        folder.display_name,
        parentLink.externalId,
      );
      const link: DriveFolderLink = {
        localFolderId: folder.id,
        externalId: external.id,
        externalParentId: parentLink.externalId,
        webUrl: external.webViewLink ?? null,
      };
      links.set(folder.id, link);
      created.push(link);
      pending.splice(index, 1);
      madeProgress = true;
    }

    if (!madeProgress) {
      throw new Error("The document folder hierarchy is incomplete.");
    }
  }

  return created;
}
