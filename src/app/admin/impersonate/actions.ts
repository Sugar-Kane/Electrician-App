"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Opening somebody else's business, and handing it back.
 *
 * Both go straight to the database functions, which are the only place that
 * checks platform admin. Nothing here decides anything — an ordinary user
 * calling these gets a refusal from Postgres, not from a missing UI button.
 */

export async function beginImpersonation(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (!organizationId) return;

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_begin_impersonation", {
    p_organization_id: organizationId,
    p_reason: reason || null,
  });

  if (error) return;

  // Everything is now read as that business, so nothing cached from before is
  // still true.
  revalidatePath("/", "layout");
  redirect("/");
}

export async function endImpersonation(): Promise<void> {
  const supabase = asFlexibleClient(await createClient());
  await supabase.rpc("admin_end_impersonation");

  revalidatePath("/", "layout");
  redirect("/admin");
}
