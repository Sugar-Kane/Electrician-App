/**
 * The walkthrough videos on the front page: what may be uploaded, what a title
 * may be, and how a video is shown.
 *
 * The files live in Vercel Blob, not in the database's storage. The database
 * is on a plan with a 50 MB limit per file and a monthly bandwidth allowance
 * the whole app shares, so a popular video could slow everything else down.
 * Blob is served from Vercel's CDN, apart from all of that. The database keeps
 * only where each file is, its title and its order.
 *
 * Import-free, so the rules can be tested without a browser or a database.
 */

export type SiteVideo = {
  id: string;
  videoUrl: string;
  posterUrl: string;
  title: string;
  description: string;
  /** The recording's own size in pixels, or 0 when it was not known. */
  width: number;
  height: number;
  durationSeconds: number;
};

export const TITLE_LIMIT = 80;
export const DESCRIPTION_LIMIT = 280;

/** Where the front page's files go in the Blob store. */
export const BLOB_FOLDER = "site-videos";

/**
 * The formats every browser plays. MOV is accepted because it is what a
 * phone hands over, but the console warns about it, because a MOV recorded
 * in high efficiency only plays in some browsers.
 */
export const VIDEO_TYPES = ["video/mp4", "video/webm", "video/quicktime"];

export const POSTER_TYPE = "image/jpeg";

/**
 * Big enough for a few minutes of screen recording at full quality, and small
 * enough that a visitor on a phone is not waiting on it. Every play of a video
 * downloads it again, so a smaller file also costs less to serve.
 */
export const VIDEO_MAX_BYTES = 250 * 1024 * 1024;

export const POSTER_MAX_BYTES = 2 * 1024 * 1024;

const EXTENSION_TYPES: Record<string, string> = {
  mp4: "video/mp4",
  m4v: "video/mp4",
  webm: "video/webm",
  mov: "video/quicktime",
};

function extensionOf(name: string): string {
  const match = /\.([a-z0-9]+)$/i.exec(name ?? "");
  return match ? match[1].toLowerCase() : "";
}

/**
 * The video's type, from what the browser says or else from its name.
 *
 * Some browsers report no type at all for a file picked from a phone's
 * library, so the name is the fallback.
 */
export function videoTypeOf(file: { name: string; type: string }): string | null {
  const reported = (file.type ?? "").toLowerCase();
  if (VIDEO_TYPES.includes(reported)) return reported;
  if (reported && !reported.startsWith("video/") && reported !== "application/octet-stream") return null;
  return EXTENSION_TYPES[extensionOf(file.name)] ?? null;
}

/** Why a file cannot be uploaded, or null when it can. */
export function videoFileProblem(file: { name: string; type: string; size: number }): string | null {
  if (!videoTypeOf(file)) {
    return "That is not a video this page can play. Upload an MP4, a WebM or a MOV.";
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return "That video looks empty. Export it again and try once more.";
  }
  if (file.size > VIDEO_MAX_BYTES) {
    return `That video is ${megabytes(file.size)}. The limit is ${megabytes(VIDEO_MAX_BYTES)}. Export it at a lower quality or trim it.`;
  }
  return null;
}

/** Whether to warn that the file may not play everywhere. */
export function mayNotPlayEverywhere(contentType: string): boolean {
  return contentType === "video/quicktime";
}

export function megabytes(bytes: number): string {
  const value = bytes / (1024 * 1024);
  return `${value >= 10 ? Math.round(value) : Math.round(value * 10) / 10} MB`;
}

/**
 * The name a file is uploaded under. Blob adds a random suffix, so two
 * uploads never overwrite each other and nobody can guess the next one.
 */
export function videoPathname(contentType: string): string {
  const extension = contentType === "video/webm" ? "webm" : contentType === "video/quicktime" ? "mov" : "mp4";
  return `${BLOB_FOLDER}/video.${extension}`;
}

export const POSTER_PATHNAME = `${BLOB_FOLDER}/poster.jpg`;

/**
 * What the upload token may be used for, by the name asked for.
 *
 * The browser names the file it is about to upload. Only the two names above
 * are allowed, each with its own types and size. Anything else gets no token,
 * so the token cannot be used to put some other file in the store.
 */
export function uploadRuleFor(pathname: string): { allowedContentTypes: string[]; maximumSizeInBytes: number } | null {
  if (/^site-videos\/video\.(mp4|webm|mov)$/.test(pathname)) {
    return { allowedContentTypes: VIDEO_TYPES, maximumSizeInBytes: VIDEO_MAX_BYTES };
  }
  if (pathname === POSTER_PATHNAME) {
    return { allowedContentTypes: [POSTER_TYPE], maximumSizeInBytes: POSTER_MAX_BYTES };
  }
  return null;
}

/** Whether a stored file's name says it was uploaded here, for this page. */
export function isSiteVideoPathname(pathname: string): boolean {
  return pathname.startsWith(`${BLOB_FOLDER}/`) && !pathname.includes("..");
}

/** Spaces as one, and nothing at either end. Titles are one line. */
function oneLine(text: string): string {
  return (text ?? "").replace(/\s+/g, " ").trim();
}

export type VideoWords = { ok: true; title: string; description: string } | { ok: false; error: string };

/** A title and description the console may save, or why not. */
export function readVideoWords(input: { title: string; description: string }): VideoWords {
  const title = oneLine(input.title);
  if (!title) return { ok: false, error: "Give the video a title." };
  if (title.length > TITLE_LIMIT) {
    return { ok: false, error: `Keep the title to ${TITLE_LIMIT} characters. It is ${title.length}.` };
  }

  const description = oneLine(input.description);
  if (description.length > DESCRIPTION_LIMIT) {
    return {
      ok: false,
      error: `Keep the description to ${DESCRIPTION_LIMIT} characters. It is ${description.length}.`,
    };
  }

  return { ok: true, title, description };
}

/** 1:42, or 1:02:05 for an hour or more. Empty when the length is unknown. */
export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = String(total % 60).padStart(2, "0");
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${minutes}:${rest}`;
}

/**
 * The frame a video is shown in: its own shape, so a recording made on a phone
 * stands upright rather than shrinking into a widescreen box. 16:9 when the
 * shape is not known.
 */
export function frameRatio(video: { width: number; height: number }): number {
  return video.width > 0 && video.height > 0 ? video.width / video.height : 16 / 9;
}

/**
 * The order after moving one video a place earlier or later.
 *
 * Moving the first one earlier, or the last one later, leaves the order as it
 * was rather than wrapping round. Nobody pressing "up" on the top video means
 * "send it to the bottom".
 */
export function moveInOrder(ids: string[], id: string, direction: "up" | "down"): string[] {
  const from = ids.indexOf(id);
  const to = direction === "up" ? from - 1 : from + 1;
  if (from === -1 || to < 0 || to >= ids.length) return ids;
  const next = [...ids];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}
