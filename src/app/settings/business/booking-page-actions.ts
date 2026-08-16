"use server";

import { revalidatePath } from "next/cache";

import { normaliseBrandColor, brandTheme } from "@/lib/branding";
import { BRANDING_BUCKET, ensureBrandingBucket } from "@/lib/branding-storage";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { checkBookingHostname } from "@/lib/tenant-domain";
import { addDomain, removeDomain, domainStatus } from "@/lib/vercel-domains";

/**
 * The booking page an electrician hands to their customers.
 *
 * Three settings, all of which change what somebody sees on the electrician's
 * own domain rather than anything inside the app: the logo, the accent colour,
 * and the hostname itself.
 */

export type BookingPageState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

async function adminContext() {
  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user?.id) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return null;

  return {
    supabase,
    organizationId,
    canManage: ["owner", "admin"].includes(text(membership?.role)),
  };
}

export async function saveBrandColor(
  _previous: BookingPageState,
  formData: FormData,
): Promise<BookingPageState> {
  const raw = String(formData.get("brandColor") ?? "").trim();

  const context = await adminContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change the booking page." };

  // Empty clears it, which is how a tenant goes back to the product's yellow.
  const colour = raw === "" ? null : normaliseBrandColor(raw);
  if (raw !== "" && !colour) return { error: "Pick a colour, or leave it blank for the default." };

  const { error } = await context.supabase
    .from("organizations")
    .update({ brand_color: colour })
    .eq("id", context.organizationId);

  if (error) {
    console.error("booking page: could not save the colour", error);
    return { error: "That colour could not be saved. Try again." };
  }

  revalidatePath("/settings/business");

  if (!colour) return { error: "", notice: "Colour cleared." };

  /*
   * Saved either way, then warned about. The contrast is a fact about the
   * colour rather than a validation failure — refusing it would mean telling an
   * electrician their own brand is not allowed — but shipping a button nobody
   * can read without saying so would be worse.
   */
  const theme = brandTheme(colour);
  return {
    error: "",
    notice:
      theme.ratio < 4.5
        ? `Saved, but text on this colour is hard to read (${theme.ratio.toFixed(1)}:1, below the 4.5:1 standard). A darker or lighter shade would be clearer.`
        : "Colour saved.",
  };
}

export async function saveLogo(
  _previous: BookingPageState,
  formData: FormData,
): Promise<BookingPageState> {
  const file = formData.get("logo");

  const context = await adminContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change the booking page." };

  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image first." };
  if (file.size > 2 * 1024 * 1024) return { error: "That image is over 2 MB. Try a smaller one." };

  const extension =
    { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/svg+xml": "svg" }[
      file.type
    ] ?? "";
  if (!extension) return { error: "Use a PNG, JPG, WebP or SVG." };

  try {
    await ensureBrandingBucket();
  } catch {
    return { error: "Logo storage is not set up yet." };
  }

  // Named by the organization, so re-uploading replaces rather than accumulates
  // — a bucket of orphaned logos is a bucket nobody ever cleans.
  const path = `${context.organizationId}/logo.${extension}`;
  const admin = getSupabaseAdmin();

  const uploaded = await admin.storage
    .from(BRANDING_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: true });

  if (uploaded.error) {
    console.error("booking page: could not upload the logo", uploaded.error);
    return { error: "That logo could not be uploaded. Try again." };
  }

  const { error } = await context.supabase
    .from("organizations")
    .update({ logo_path: path })
    .eq("id", context.organizationId);

  if (error) {
    console.error("booking page: could not record the logo", error);
    return { error: "That logo could not be saved. Try again." };
  }

  revalidatePath("/settings/business");
  return { error: "", notice: "Logo saved." };
}

export async function saveBookingDomain(
  _previous: BookingPageState,
  formData: FormData,
): Promise<BookingPageState> {
  const raw = String(formData.get("hostname") ?? "");

  const context = await adminContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change the booking page." };

  const checked = checkBookingHostname(raw);
  if (!checked.ok) return { error: checked.error };

  const { error } = await context.supabase.from("organization_domains").insert({
    organization_id: context.organizationId,
    hostname: checked.hostname,
  });

  if (error) {
    // The unique index. Somebody else has it, or this business already added it.
    if (String(error.code) === "23505") {
      return { error: "That domain is already in use." };
    }
    console.error("booking page: could not save the domain", error);
    return { error: "That domain could not be saved. Try again." };
  }

  // The row is what matters and it is already written; a platform hiccup here
  // is reported without losing the setting.
  const added = await addDomain(checked.hostname);

  revalidatePath("/settings/business");

  return {
    error: "",
    notice: added.error
      ? `Saved. ${added.error}`
      : `Saved. Add a CNAME for ${checked.hostname} pointing to cname.vercel-dns.com, then check it below.`,
  };
}

export async function checkBookingDomain(
  _previous: BookingPageState,
  formData: FormData,
): Promise<BookingPageState> {
  const domainId = String(formData.get("domainId") ?? "").trim();

  const context = await adminContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change the booking page." };

  const { data } = await context.supabase
    .from("organization_domains")
    .select("id, hostname")
    .eq("organization_id", context.organizationId)
    .eq("id", domainId)
    .maybeSingle();

  const hostname = text(data?.hostname);
  if (!hostname) return { error: "That domain could not be found." };

  const status = await domainStatus(hostname);

  await context.supabase
    .from("organization_domains")
    .update({ verified_at: status.ready ? new Date().toISOString() : null })
    .eq("organization_id", context.organizationId)
    .eq("id", domainId);

  revalidatePath("/settings/business");

  return {
    error: status.ready ? "" : status.instruction,
    notice: status.ready ? `${hostname} is live.` : undefined,
  };
}

export async function removeBookingDomain(
  _previous: BookingPageState,
  formData: FormData,
): Promise<BookingPageState> {
  const domainId = String(formData.get("domainId") ?? "").trim();

  const context = await adminContext();
  if (!context) return { error: "You are not signed in." };
  if (!context.canManage) return { error: "Only an owner can change the booking page." };

  const { data } = await context.supabase
    .from("organization_domains")
    .select("id, hostname")
    .eq("organization_id", context.organizationId)
    .eq("id", domainId)
    .maybeSingle();

  const hostname = text(data?.hostname);
  if (!hostname) return { error: "That domain could not be found." };

  const { error } = await context.supabase
    .from("organization_domains")
    .delete()
    .eq("organization_id", context.organizationId)
    .eq("id", domainId);

  if (error) {
    console.error("booking page: could not remove the domain", error);
    return { error: "That domain could not be removed. Try again." };
  }

  // After the row, so a platform failure cannot leave a domain the app still
  // believes it serves.
  await removeDomain(hostname);

  revalidatePath("/settings/business");
  return { error: "", notice: `${hostname} removed. Point its DNS somewhere else.` };
}
