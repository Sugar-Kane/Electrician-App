import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";

import { BRANDING_BUCKET, logoUrl } from "@/lib/branding-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The business's logo as it heads an email: a navy badge with the mark on it.
 *
 * Logos are made for white paper, and a mail app in dark mode repaints the
 * header behind them. Gmail turned the navy band pale and left a white mark
 * floating on it, unreadable, at the full 220px a wordmark was sized for. A
 * picture is the one thing no mail app repaints, so the email's copy carries
 * its own background: the logo trimmed to its ink, the dark ink turned white,
 * coloured parts left as they are, on solid navy. On the navy header it sits
 * flush; on a repainted header it reads as a badge. The business's name is
 * written beside it as text (email-layout.ts), which every app recolours
 * correctly.
 *
 * Made once per logo and kept beside it in the public branding bucket. The
 * file name carries the logo's path and the picture's size, so a new logo gets
 * a new copy and the layout knows the shape without fetching it. Never throws:
 * without a logo, or when the copy cannot be made, "" and the header shows the
 * name alone.
 */

const FOLDER = "email-header";
/** Bumped when the drawing changes, so old copies are not reused. */
const DRAWING = "b2";
const NAVY = { r: 6, g: 19, b: 29 };
/** Drawn at about three times the 56px it is shown at. */
const BADGE_HEIGHT = 192;
const BADGE_PADDING = 24;

/** The logo as a navy badge: trimmed, dark ink made white, on solid navy. */
export async function logoBadge(bytes: Buffer): Promise<{ png: Buffer; width: number; height: number }> {
  const { data, info } = await sharp(bytes, { density: 300 })
    .resize({ width: 880, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let left = info.width;
  let top = info.height;
  let right = -1;
  let bottom = -1;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i]!;
    const g = data[i + 1]!;
    const b = data[i + 2]!;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const saturation = max === 0 ? 0 : (max - min) / max;
    const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (luminance > 235 && saturation < 0.1) {
      data[i + 3] = 0;
    } else if (luminance < 110 || (saturation < 0.2 && luminance < 150)) {
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
    }
    if (data[i + 3]! > 16) {
      const pixel = i / 4;
      const x = pixel % info.width;
      const y = (pixel - x) / info.width;
      if (x < left) left = x;
      if (x > right) right = x;
      if (y < top) top = y;
      if (y > bottom) bottom = y;
    }
  }
  if (right < left || bottom < top) throw new Error("The logo has nothing in it.");

  const ink = await sharp(data, { raw: info })
    .extract({ left, top, width: right - left + 1, height: bottom - top + 1 })
    .resize({ height: BADGE_HEIGHT - BADGE_PADDING * 2 })
    .png()
    .toBuffer({ resolveWithObject: true });
  const width = ink.info.width + BADGE_PADDING * 2;
  const png = await sharp({ create: { width, height: BADGE_HEIGHT, channels: 4, background: { ...NAVY, alpha: 1 } } })
    .composite([{ input: ink.data, left: BADGE_PADDING, top: BADGE_PADDING }])
    .flatten({ background: NAVY })
    .png()
    .toBuffer();
  return { png, width, height: BADGE_HEIGHT };
}

export async function emailLogoUrl(organizationId: string | undefined): Promise<string> {
  if (!organizationId) return "";
  try {
    const database = getSupabaseAdmin();
    const { data } = await database.from("organizations").select("logo_path").eq("id", organizationId).maybeSingle();
    const source = ((data as { logo_path?: string | null } | null)?.logo_path ?? "").trim().replace(/^\/+/, "");
    if (!source) return "";

    // "<logo>-b2-<width>x<height>.png": found by its start, read by its end.
    const stem = `${createHash("sha256").update(source).digest("hex").slice(0, 24)}-${DRAWING}-`;
    const bucket = database.storage.from(BRANDING_BUCKET);
    const existing = await bucket.list(FOLDER, { search: stem });
    const kept = existing.data?.find((file) => file.name.startsWith(stem) && /-\d+x\d+\.png$/.test(file.name));
    if (kept) return logoUrl(`${FOLDER}/${kept.name}`);

    const original = await bucket.download(source);
    if (original.error || !original.data) return "";
    const made = await logoBadge(Buffer.from(await original.data.arrayBuffer()));
    const copy = `${FOLDER}/${stem}${made.width}x${made.height}.png`;
    const uploaded = await bucket.upload(copy, made.png, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    return uploaded.error ? "" : logoUrl(copy);
  } catch {
    return "";
  }
}
