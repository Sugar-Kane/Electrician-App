"use server";

import { revalidatePath } from "next/cache";

import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";
import { hashWebsiteKey, newWebsiteKey } from "@/lib/website-intake";

export type WebsiteKeyState = { error: string; key?: string };

/** A key for the business's own website to send requests with, shown once. */
export async function createWebsiteKey(): Promise<WebsiteKeyState> {
  const context = await currentContext();
  if (!context || context.role !== "owner") return { error: "Only the business owner can connect a website." };

  const key = newWebsiteKey();
  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.from("website_intake_keys").insert({
    organization_id: context.organizationId,
    key_hash: hashWebsiteKey(key),
    created_by: context.userId,
  });
  if (error) return { error: "The website key could not be created." };

  revalidatePath("/settings/integrations");
  return { error: "", key };
}

export async function revokeWebsiteKey(formData: FormData) {
  const context = await currentContext();
  if (!context || context.role !== "owner") return;
  const id = String(formData.get("keyId") ?? "");
  if (!id) return;
  const supabase = asFlexibleClient(await createClient());
  await supabase
    .from("website_intake_keys")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", id)
    .eq("organization_id", context.organizationId);
  revalidatePath("/settings/integrations");
}
