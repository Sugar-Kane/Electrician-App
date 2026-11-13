import "server-only";

import { createHash } from "node:crypto";
import sharp from "sharp";

import { BRANDING_BUCKET, logoUrl } from "@/lib/branding-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

/**
 * The business's logo as it heads an email: drawn for a navy header.
 *
 * Logos are made for white paper — dark lettering, a coloured mark — and on a
 * navy header the lettering disappears, while a white box around the logo
 * reads as a hole in a dark-mode inbox. So the email gets its own copy: the
 * dark ink turned white, a white background (a JPEG's) made clear, and the
 * coloured parts left as they are. Pacific Plains' gold tower stays gold; the
 * black "PACIFIC PLAINS" becomes white.
 *
 * Made once per logo and kept beside it in the public branding bucket, named
 * from the logo's own path, so a new logo gets a new copy and the email links
 * to a stable public URL. Never throws: without a logo, or when the copy cannot
 * be made, "" — and the email's header shows the business name instead.
 */

const FOLDER = "email-header";

/** The logo with dark ink made white and a plain white background made clear. */
export async function logoForDarkHeader(bytes: Buffer): Promise<Buffer> {
  const { data, info } = await sharp(bytes, { density: 300 })
    .resize({ width: 880, withoutEnlargement: true })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
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
  }
  return sharp(data, { raw: info }).png().toBuffer();
}

export async function emailLogoUrl(organizationId: string | undefined): Promise<string> {
  if (!organizationId) return "";
  try {
    const database = getSupabaseAdmin();
    const { data } = await database.from("organizations").select("logo_path").eq("id", organizationId).maybeSingle();
    const source = ((data as { logo_path?: string | null } | null)?.logo_path ?? "").trim().replace(/^\/+/, "");
    if (!source) return "";

    const copy = `${FOLDER}/${createHash("sha256").update(source).digest("hex").slice(0, 24)}.png`;
    const bucket = database.storage.from(BRANDING_BUCKET);
    const existing = await bucket.list(FOLDER, { search: copy.slice(FOLDER.length + 1) });
    if (existing.data?.some((file) => `${FOLDER}/${file.name}` === copy)) return logoUrl(copy);

    const original = await bucket.download(source);
    if (original.error || !original.data) return "";
    const made = await logoForDarkHeader(Buffer.from(await original.data.arrayBuffer()));
    const uploaded = await bucket.upload(copy, made, { contentType: "image/png", upsert: true, cacheControl: "31536000" });
    return uploaded.error ? "" : logoUrl(copy);
  } catch {
    return "";
  }
}
