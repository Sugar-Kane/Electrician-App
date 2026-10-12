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

/** What a past visit's outcome choice adds to the reason on the record. */
const CHOICES: Record<string, string> = {
  reschedule: "the visit didn't happen; rescheduling",
  complete: "the work happened; completing",
};

export async function beginImpersonation(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return;
  const back = `/admin/organizations/${organizationId}`;

  // Opened from a past visit: straight to that job, with the choice on the record.
  const next = String(formData.get("next") ?? "");
  const job = /^\/jobs\/(\d{1,9})$/.exec(next);
  const choice = CHOICES[String(formData.get("choice") ?? "")];
  const suffix = job && choice ? ` · job #${job[1]}: ${choice}` : "";
  const typed = String(formData.get("reason") ?? "").trim();
  const reason = typed.length >= 3 ? `${typed.slice(0, 200 - suffix.length)}${suffix}` : typed;

  // The database refuses without a reason too; this only says so sooner.
  if (reason.length < 3) redirect(`${back}?elevate=reason#elevate`);

  const supabase = asFlexibleClient(await createClient());
  const { error } = await supabase.rpc("admin_begin_impersonation", {
    p_organization_id: organizationId,
    p_reason: reason,
  });

  if (error) redirect(`${back}?elevate=${error.code === "22023" ? "reason" : "refused"}#elevate`);

  // Everything is now read as that business, so nothing cached from before is
  // still true.
  revalidatePath("/", "layout");
  redirect(job ? next : "/");
}

export async function endImpersonation(): Promise<void> {
  const supabase = asFlexibleClient(await createClient());
  await supabase.rpc("admin_end_impersonation");

  revalidatePath("/", "layout");
  redirect("/admin");
}
