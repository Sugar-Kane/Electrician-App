"use server";

import { revalidatePath } from "next/cache";

import { recordActivity } from "@/lib/activity";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The job steps that are finished with one tap rather than in a section of
 * their own. Today that is the materials: gathered and loaded, or not yet.
 *
 * Through the caller's session, so the jobs table's own policies decide whether
 * this person may touch this business's job.
 */

export type StepActionState = { error: string; notice?: string };

export async function setMaterialsReady(
  _previous: StepActionState,
  formData: FormData,
): Promise<StepActionState> {
  const jobNumber = Number(String(formData.get("jobNumber") ?? "").trim());
  if (!Number.isFinite(jobNumber)) return { error: "That job could not be found." };
  const ready = String(formData.get("ready") ?? "true") !== "false";

  const supabase = asFlexibleClient(await createClient());
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "You are not signed in." };

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();
  const organizationId = String(membership?.organization_id ?? "");
  if (!organizationId) return { error: "You are not a member of a business." };

  const { data: job } = await supabase
    .from("jobs")
    .update({ materials_ready_at: ready ? new Date().toISOString() : null })
    .eq("organization_id", organizationId)
    .eq("job_number", jobNumber)
    .select("id, organization_id")
    .maybeSingle();

  if (!job) return { error: "That job could not be found." };

  await recordActivity(supabase, {
    organizationId: String(job.organization_id),
    eventType: ready ? "job.materials_ready" : "job.materials_not_ready",
    label: ready ? "Materials marked ready" : "Materials marked not ready",
    jobId: String(job.id),
  });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/jobs");
  return { error: "", notice: ready ? "Materials marked ready." : "Materials marked not ready." };
}
