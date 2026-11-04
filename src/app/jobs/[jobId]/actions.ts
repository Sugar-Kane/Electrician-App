"use server";

import { revalidatePath } from "next/cache";

import { callOffJob, changeJob, loadChangeJob } from "@/lib/job-changes-server";
import { readAccessNotes, readStreetAddress, readUnit } from "@/lib/property-details";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Editing and calling off a job.
 *
 * Reads and writes go through the caller's session, so RLS decides whether they
 * may touch this job at all — the job number in the form is a lookup key, never
 * an authorisation. The customer is only told once the change has actually been
 * saved, so a failed write can never send a text about something that did not
 * happen.
 */

export type JobActionState = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** The job as the actions need it, found the way the pages link to it. */
async function loadJob(jobNumber: string) {
  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  return loadChangeJob(supabase, text(membership?.organization_id), jobNumber);
}

/**
 * The address and its details, changed after the job was written down.
 *
 * They belong to the property, not the job, because the gate code is the same
 * next month: saving them here changes what every job at this address shows.
 * Nothing is sent to the customer.
 *
 * The street, city, state and ZIP can be corrected too. A typo in any of them
 * used to need somebody with database access — a job saved as "Midland, CA"
 * with a Texas ZIP was pinned in the middle of California until it was fixed
 * by hand. A contract already generated keeps the address it was written
 * with: its text is stored when it is made, and a signed one is hashed.
 */
export async function updateJobPlace(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const unit = readUnit(formData.get("addressLine2"));
  const accessNotes = readAccessNotes(formData.get("accessNotes"));
  const address = readStreetAddress({
    line1: formData.get("addressLine1"),
    city: formData.get("city"),
    state: formData.get("state"),
    postalCode: formData.get("postalCode"),
  });
  if (!address.ok) return { error: address.error };

  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };
  if (job.status === "canceled") {
    return { error: "This job is canceled. Cancelled jobs cannot be edited." };
  }
  if (!job.propertyId) {
    return { error: "This job has no address, so there is nowhere to keep these." };
  }

  const { data: saved } = await job.supabase
    .from("properties")
    .select("address_line_1, city, state, postal_code")
    .eq("id", job.propertyId)
    .eq("organization_id", job.organizationId)
    .maybeSingle();
  if (!saved) return { error: "That address could not be found." };

  // A different place needs a new pin. Cleared here, the route page looks the
  // corrected address up the next time it opens; kept, the stop would be drawn
  // where the typo put it.
  const moved =
    text(saved.address_line_1) !== address.value.line1 ||
    text(saved.city) !== address.value.city ||
    text(saved.state) !== address.value.state ||
    text(saved.postal_code) !== address.value.postalCode;

  const { data, error } = await job.supabase
    .from("properties")
    .update({
      address_line_1: address.value.line1,
      address_line_2: unit || null,
      city: address.value.city,
      state: address.value.state,
      postal_code: address.value.postalCode,
      access_notes: accessNotes || null,
      ...(moved ? { latitude: null, longitude: null } : {}),
    })
    .eq("id", job.propertyId)
    .eq("organization_id", job.organizationId)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "Those details could not be saved." };
  }

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  if (moved) revalidatePath("/route");
  return { error: "", notice: "Saved. Every job at this address shows these." };
}

export async function updateJob(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };

  const result = await changeJob(job, {
    startLocal: String(formData.get("start") ?? "").trim(),
    endLocal: String(formData.get("end") ?? "").trim(),
    status: String(formData.get("status") ?? "").trim(),
    notifyCustomer: formData.get("notifyCustomer") === "on",
  });
  if (result.error) return { error: result.error };

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  revalidatePath("/schedule");
  if ((result.partsUsed ?? []).length > 0) {
    revalidatePath("/inventory");
    revalidatePath("/materials");
  }
  return { error: "", notice: result.notice };
}

/** Call a job off and tell the customer (job-changes-server.ts). */
export async function cancelJob(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };

  const result = await callOffJob(job, String(formData.get("reason") ?? ""));
  if (result.error) return { error: result.error };

  if ((result.restocked ?? 0) > 0) {
    revalidatePath("/inventory");
    revalidatePath("/materials");
  }
  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  revalidatePath("/schedule");
  revalidatePath("/");
  return { error: "", notice: result.notice };
}
