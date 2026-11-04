"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Changing how much built-in AI a business gets, from the admin console.
 *
 * The database decides who may: both functions refuse anybody who is not a
 * platform owner, and write the change and its reason to the admin audit log.
 */

const UUID = /^[0-9a-f-]{36}$/i;

function readLimit(raw: FormDataEntryValue | null): number | null | "bad" {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : "bad";
}

export async function setBusinessAiAllowance(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");
  if (!UUID.test(organizationId)) return;
  const back = `/admin/organizations/${organizationId}?tab=summary`;
  const mode = String(formData.get("mode") ?? "");
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (reason.length < 3) redirect(`${back}&ai=reason#ai`);

  const limit = mode === "custom" ? readLimit(formData.get("limit")) : null;
  if (mode === "custom" && (limit === null || limit === "bad")) redirect(`${back}&ai=number#ai`);
  if (!["default", "custom", "unlimited"].includes(mode)) redirect(`${back}&ai=error#ai`);

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_set_ai_allowance", {
    p_organization_id: organizationId,
    p_monthly_limit: mode === "custom" ? limit : null,
    p_unlimited: mode === "unlimited",
    p_reason: reason,
  });
  revalidatePath(`/admin/organizations/${organizationId}`);
  redirect(`${back}&ai=${error ? "refused" : "saved"}#ai`);
}

export async function setDefaultAiLimit(formData: FormData): Promise<void> {
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  if (reason.length < 3) redirect("/admin/overview?ai=reason#ai");
  const limit = readLimit(formData.get("limit"));
  if (limit === "bad") redirect("/admin/overview?ai=number#ai");

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_set_ai_default_limit", { p_limit: limit, p_reason: reason });
  revalidatePath("/admin/overview");
  redirect(`/admin/overview?ai=${error ? "refused" : "saved"}#ai`);
}
