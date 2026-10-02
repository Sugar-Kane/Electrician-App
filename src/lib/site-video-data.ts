import "server-only";

import type { SiteVideo } from "@/lib/site-videos";
import { createPublicClient } from "@/lib/supabase/public";

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function number(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * The front page's videos, in the order they play.
 *
 * Read as nobody in particular, because the front page is shown to visitors and
 * anybody may read these rows. Empty when there are none yet, or when they
 * cannot be read: the front page then shows the sample job in their place,
 * which is better than not showing the front page. Never rejects, because the
 * front page streams it into a section of its own.
 */
export async function listSiteVideos(): Promise<SiteVideo[]> {
  try {
    const { data, error } = await createPublicClient()
      .from("site_videos")
      .select("id, video_url, poster_url, title, description, width, height, duration_seconds")
      .order("position", { ascending: true })
      .order("created_at", { ascending: true });

    if (error || !Array.isArray(data)) return [];

    return data.map((row: Record<string, unknown>) => ({
      id: text(row.id),
      videoUrl: text(row.video_url),
      posterUrl: text(row.poster_url),
      title: text(row.title),
      description: text(row.description),
      width: number(row.width),
      height: number(row.height),
      durationSeconds: number(row.duration_seconds),
    }));
  } catch {
    return [];
  }
}

/**
 * Whether files can be uploaded at all: a Blob store is connected to the
 * project, which is what puts its token in the environment.
 */
export function videoStorageConnected(): boolean {
  return Boolean(process.env.BLOB_READ_WRITE_TOKEN?.trim());
}
