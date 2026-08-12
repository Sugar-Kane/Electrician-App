"use server";

import { revalidatePath } from "next/cache";

import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Putting somebody on a job.
 *
 * The word "Unassigned" appeared on job cards, on the job page and in the
 * dashboard's own warning about it, and none of the three could do anything
 * about it. The only route to assigning a technician was the status form buried
 * on the job's settings page — so the alert told an owner to fix something and
 * then pointed at a screen with no way to fix it.
 *
 * Reads and writes go through the caller's session, so RLS decides whether this
 * job is theirs. The job number in the form is a lookup key, never an
 * authorisation.
 */

export type AssignState = { error: string; notice?: string };

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export type CrewMember = { id: string; name: string; isActive: boolean };

/**
 * Who can be sent, newest names last.
 *
 * Inactive technicians are still listed — somebody on holiday is still the
 * right answer for a job next month, and a name silently missing from a picker
 * is a bug report rather than a policy.
 */
export async function listCrew(): Promise<CrewMember[]> {
  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = str(membership?.organization_id);
  if (!organizationId) return [];

  const { data } = await supabase
    .from("technicians")
    .select("id, display_name, is_active")
    .eq("organization_id", organizationId)
    .order("is_active", { ascending: false })
    .order("display_name");

  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: str(row.id),
    name: str(row.display_name),
    isActive: row.is_active !== false,
  }));
}

/**
 * Assign, reassign, or take somebody off.
 *
 * An empty technician id means unassign, which is a real thing to want: a job
 * whose technician has gone off sick is better unassigned than assigned to
 * somebody who is not coming.
 *
 * Nothing is sent to the customer. Who turns up is the business's own business,
 * and the customer was told a time rather than a name.
 */
export async function assignTechnician(
  _previous: AssignState,
  formData: FormData,
): Promise<AssignState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const technicianId = String(formData.get("technicianId") ?? "").trim();

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = str(membership?.organization_id);
  if (!organizationId) return { error: "You are not a member of a business." };

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return { error: "That job could not be found." };

  // Checked against this business's own crew rather than trusted, so a stale or
  // crafted form cannot put another company's technician on the job.
  let name = "";
  if (technicianId) {
    const { data: technician } = await supabase
      .from("technicians")
      .select("display_name")
      .eq("organization_id", organizationId)
      .eq("id", technicianId)
      .maybeSingle();

    name = str(technician?.display_name);
    if (!name) return { error: "That technician is not on your crew." };
  }

  const { data, error } = await supabase
    .from("jobs")
    .update({ technician_id: technicianId || null })
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That could not be saved. Try again." };
  }

  // The dashboard's unassigned count and the schedule both read this, so both
  // are refreshed rather than left to go stale until somebody navigates.
  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/schedule");
  revalidatePath("/");

  return { error: "", notice: name ? `${name} is on this job.` : "Nobody is on this job." };
}
