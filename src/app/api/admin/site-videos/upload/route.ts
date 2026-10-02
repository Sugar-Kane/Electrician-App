import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

import { isPlatformAdmin } from "@/lib/admin-console";
import { videoStorageConnected } from "@/lib/site-video-data";
import { uploadRuleFor } from "@/lib/site-videos";

/**
 * Permission to upload one front page file straight from the browser to
 * Vercel Blob.
 *
 * A video is far bigger than a request to this app may be, so the file never
 * comes through here. The browser asks this route for a short-lived token,
 * then sends the file to Blob with it. The token is only given to a platform
 * admin, only for the two names the console uploads under, and only for those
 * types and sizes, which Blob itself enforces.
 *
 * Nothing is recorded here. The console records the video once both files
 * have arrived, so a half-finished upload never reaches the front page.
 */

const NO_STORE = { "Cache-Control": "private, no-store" };

export async function POST(request: Request) {
  if (!videoStorageConnected()) {
    return Response.json(
      { error: "Video storage is not connected yet." },
      { status: 503, headers: NO_STORE },
    );
  }

  let body: HandleUploadBody;
  try {
    body = (await request.json()) as HandleUploadBody;
  } catch {
    return Response.json({ error: "That request could not be read." }, { status: 400, headers: NO_STORE });
  }

  // Only the token request is handled. No callback is asked for when an upload
  // finishes, because the console records the video itself once it has.
  if (body?.type !== "blob.generate-client-token") {
    return Response.json({ error: "That request is not handled here." }, { status: 400, headers: NO_STORE });
  }

  if (!(await isPlatformAdmin())) {
    return Response.json({ error: "Only Volteira support can upload videos." }, { status: 403, headers: NO_STORE });
  }

  try {
    const result = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        const rule = uploadRuleFor(pathname);
        if (!rule) throw new Error(`No uploads to ${pathname}.`);
        return {
          ...rule,
          addRandomSuffix: true,
          // Long enough for the largest video over a slow connection. The
          // token is checked again for every part of the upload.
          validUntil: Date.now() + 3 * 60 * 60 * 1000,
        };
      },
    });
    return Response.json(result, { headers: NO_STORE });
  } catch (error) {
    console.error("site videos: upload token refused", error);
    return Response.json({ error: "That upload could not be started." }, { status: 400, headers: NO_STORE });
  }
}
