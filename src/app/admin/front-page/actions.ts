"use server";

import { del, head } from "@vercel/blob";
import { revalidatePath } from "next/cache";

import { isPlatformAdmin } from "@/lib/admin-console";
import {
  POSTER_TYPE,
  VIDEO_TYPES,
  isSiteVideoPathname,
  moveInOrder,
  readVideoWords,
} from "@/lib/site-videos";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Changing the front page's videos from the support console.
 *
 * Each of these checks for a platform admin before doing anything. The
 * database would refuse the rows anyway, but the files in Blob are changed
 * with this app's own key, which the database knows nothing about. A change
 * the database refuses changes no rows rather than failing, which is why each
 * one asks for the rows it changed and treats none as an error.
 */

export type SiteVideoState = { error: string; notice?: string };

export type NewSiteVideo = {
  videoUrl: string;
  /** Empty when the browser could not take a frame from the video. */
  posterUrl: string;
  title: string;
  description: string;
  width: number;
  height: number;
  durationSeconds: number;
};

const NOT_ADMIN = "Only Volteira support can change the front page.";

function refresh() {
  revalidatePath("/");
  // The front page visitors are actually served, built ahead of time.
  revalidatePath("/welcome");
  revalidatePath("/admin/front-page");
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

async function database() {
  return asFlexibleClient(await createClient());
}

/**
 * A file uploaded to this project's store for the front page, as the store
 * describes it, or null.
 *
 * Asked of the store rather than taken from the browser. It confirms the
 * upload finished, that the file is in this store and this page's folder,
 * and what type it really is.
 */
async function storedFile(url: string, types: string[]): Promise<{ url: string; size: number; contentType: string } | null> {
  if (!url) return null;
  try {
    const found = await head(url);
    if (!isSiteVideoPathname(found.pathname) || !types.includes(found.contentType)) return null;
    return { url: found.url, size: found.size, contentType: found.contentType };
  } catch {
    return null;
  }
}

/**
 * Removes files from the store that no video on the page still uses.
 *
 * The check matters on the refusal path: a request naming a file that is
 * already on the page must not take it off the page by being refused. Best
 * effort otherwise, because a file left behind costs storage and nothing else.
 */
async function removeUnusedFiles(urls: string[]) {
  const named = urls.filter(Boolean);
  if (named.length === 0) return;

  try {
    const supabase = await database();
    const [videos, posters] = await Promise.all([
      supabase.from("site_videos").select("video_url").in("video_url", named),
      supabase.from("site_videos").select("poster_url").in("poster_url", named),
    ]);
    if (videos.error || posters.error) return;

    const inUse = new Set([
      ...(videos.data ?? []).map((row) => String(row.video_url)),
      ...(posters.data ?? []).map((row) => String(row.poster_url)),
    ]);
    const unused = named.filter((url) => !inUse.has(url));
    if (unused.length > 0) await del(unused);
  } catch (error) {
    console.error("site videos: files could not be removed", error);
  }
}

function pixels(value: number): number | null {
  return Number.isInteger(value) && value > 0 && value <= 16384 ? value : null;
}

/**
 * Put a video that has just been uploaded on the front page, at the end.
 *
 * When this refuses, it removes the files it was given, so a refused video
 * does not linger in the store with nothing pointing at it.
 */
export async function addSiteVideo(input: NewSiteVideo): Promise<SiteVideoState> {
  if (!(await isPlatformAdmin())) return { error: NOT_ADMIN };

  const words = readVideoWords({ title: input.title, description: input.description });
  const video = await storedFile(input.videoUrl, VIDEO_TYPES);
  const poster = await storedFile(input.posterUrl, [POSTER_TYPE]);

  const refuse = async (error: string): Promise<SiteVideoState> => {
    await removeUnusedFiles([video?.url ?? "", poster?.url ?? ""]);
    return { error };
  };

  if (!words.ok) return refuse(words.error);
  if (!video) return refuse("That video did not finish uploading. Try again.");

  const width = pixels(input.width);
  const height = pixels(input.height);
  const shaped = width !== null && height !== null;

  const supabase = await database();

  const { data: last } = await supabase
    .from("site_videos")
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = typeof last?.position === "number" ? last.position + 1 : 0;

  const { error } = await supabase.from("site_videos").insert({
    video_url: video.url,
    poster_url: poster?.url ?? null,
    content_type: video.contentType,
    size_bytes: video.size,
    width: shaped ? width : null,
    height: shaped ? height : null,
    duration_seconds:
      Number.isFinite(input.durationSeconds) && input.durationSeconds > 0
        ? Math.round(input.durationSeconds * 100) / 100
        : null,
    title: words.title,
    description: words.description,
    position,
  });

  if (error) {
    console.error("site videos: could not be added", error);
    return refuse("That video could not be added. Try again.");
  }

  refresh();
  return { error: "", notice: `Added “${words.title}”. It is on the front page now.` };
}

export async function updateSiteVideo(_previous: SiteVideoState, formData: FormData): Promise<SiteVideoState> {
  if (!(await isPlatformAdmin())) return { error: NOT_ADMIN };

  const id = field(formData, "id").trim();
  if (!id) return { error: "That video could not be found." };

  const words = readVideoWords({ title: field(formData, "title"), description: field(formData, "description") });
  if (!words.ok) return { error: words.error };

  const { data, error } = await (await database())
    .from("site_videos")
    .update({ title: words.title, description: words.description, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("id");

  if (error) return { error: "That video could not be saved. Try again." };
  if (!data?.length) return { error: "That video could not be found." };

  refresh();
  return { error: "", notice: "Saved." };
}

export async function moveSiteVideo(_previous: SiteVideoState, formData: FormData): Promise<SiteVideoState> {
  if (!(await isPlatformAdmin())) return { error: NOT_ADMIN };

  const id = field(formData, "id").trim();
  const direction = field(formData, "direction") === "up" ? "up" : "down";

  const supabase = await database();
  const { data: rows, error: readError } = await supabase
    .from("site_videos")
    .select("id, position")
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  if (readError || !rows) return { error: "The order could not be changed. Try again." };

  const was = new Map(rows.map((row) => [String(row.id), Number(row.position)]));
  const order = moveInOrder([...was.keys()], id, direction);

  // Every video is given its place in the new order, which also settles any
  // two that shared a position. Only the ones whose place changed are written.
  for (const [position, rowId] of order.entries()) {
    if (was.get(rowId) === position) continue;
    const { data, error } = await supabase
      .from("site_videos")
      .update({ position, updated_at: new Date().toISOString() })
      .eq("id", rowId)
      .select("id");
    if (error || !data?.length) return { error: "The order could not be changed. Try again." };
  }

  refresh();
  return { error: "" };
}

export async function removeSiteVideo(_previous: SiteVideoState, formData: FormData): Promise<SiteVideoState> {
  if (!(await isPlatformAdmin())) return { error: NOT_ADMIN };

  const id = field(formData, "id").trim();
  if (!id) return { error: "That video could not be found." };

  const { data, error } = await (await database())
    .from("site_videos")
    .delete()
    .eq("id", id)
    .select("title, video_url, poster_url");

  if (error || !data?.length) return { error: "That video could not be removed. Try again." };

  // Off the page first, then out of the store, so a failure here can only
  // leave an unused file behind, never a broken video on the page.
  const row = data[0];
  await removeUnusedFiles([String(row.video_url ?? ""), String(row.poster_url ?? "")]);

  refresh();
  return { error: "", notice: `Removed “${String(row.title)}” from the front page.` };
}
