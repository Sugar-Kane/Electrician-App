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

/**
 * The job's diagnostic fee, off or back on, from Job settings.
 *
 * Off is a fee of zero, so the job's next contract has no diagnostic fee line
 * and nothing is credited on its invoice. Money on the job, so it follows the
 * billing permission: a technician may change it only where the owner allows
 * technicians to edit billing. A contract already drafted keeps what it says;
 * draft it again to match.
 */
export async function setJobDiagnosticFee(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = Number(String(formData.get("jobNumber") ?? "").trim());
  const charge = formData.get("charge") === "on";
  if (!Number.isInteger(jobNumber) || jobNumber <= 0) return { error: "That job could not be found." };

  const { billingRefusal } = await import("@/lib/billing-permission-server");
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };

  const supabase = asFlexibleClient(await createClient());
  const { data: membership } = await supabase.from("organization_members").select("organization_id").limit(1).maybeSingle();
  const organizationId = text(membership?.organization_id);
  if (!organizationId) return { error: "You are not signed in." };

  const [{ data: jobRow }, { data: settings }] = await Promise.all([
    supabase
      .from("jobs")
      .select("id, status, diagnostic_fee_cents, diagnostic_paid, follow_up_of")
      .eq("organization_id", organizationId)
      .eq("job_number", jobNumber)
      .maybeSingle(),
    supabase.from("service_settings").select("diagnostic_fee_cents").eq("organization_id", organizationId).maybeSingle(),
  ]);
  const job = jobRow as Record<string, unknown> | null;
  if (!job) return { error: "That job could not be found." };

  const { diagnosticFeeChange } = await import("@/lib/diagnostic-toggle");
  const change = diagnosticFeeChange(
    {
      feeCents: Number(job.diagnostic_fee_cents ?? 0),
      paid: job.diagnostic_paid === true,
      followUp: Boolean(text(job.follow_up_of)),
      canceled: job.status === "canceled",
    },
    charge,
    typeof settings?.diagnostic_fee_cents === "number" ? settings.diagnostic_fee_cents : null,
  );
  if ("error" in change) return { error: change.error };

  const { data: saved, error } = await supabase
    .from("jobs")
    .update({ diagnostic_fee_cents: change.feeCents })
    .eq("id", text(job.id))
    .eq("organization_id", organizationId)
    .eq("diagnostic_paid", false)
    .select("id")
    .maybeSingle();
  if (error || !saved) {
    return { error: charge ? "The diagnostic fee could not be turned on. Try again." : "The diagnostic fee could not be turned off. It may have just been paid; reload the job." };
  }

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  return {
    error: "",
    notice: charge
      ? `Diagnostic fee turned on: $${(change.feeCents / 100).toFixed(2)}.`
      : "Diagnostic fee turned off for this job. Draft the contract again if one was already made, so it matches.",
  };
}

/**
 * End the visit under way with the job still open, and book the next one
 * (job-visits-server.ts). The visit is kept in the job's history.
 */
export async function endVisitForReturnAction(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };
  const { data: auth } = await job.supabase.auth.getUser();

  const { endVisitForReturn } = await import("@/lib/job-visits-server");
  const result = await endVisitForReturn(job, {
    startLocal: String(formData.get("start") ?? "").trim(),
    endLocal: String(formData.get("end") ?? "").trim(),
    note: String(formData.get("note") ?? ""),
    notifyCustomer: formData.get("notifyCustomer") === "on",
    userId: auth.user?.id ?? "",
  });
  if (result.error) return { error: result.error };

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/schedule");
  revalidatePath("/");
  return { error: "", notice: result.notice };
}
