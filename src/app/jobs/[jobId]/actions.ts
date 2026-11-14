"use server";

import { revalidatePath } from "next/cache";

import { completeDraftFields, placeholdersUsed } from "@/lib/contract-template";
import { callOffJob, changeJob, loadChangeJob } from "@/lib/job-changes-server";
import { readAccessNotes, readStreetAddress, readUnit } from "@/lib/property-details";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
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
    // No address yet: this one becomes the job's place.
    const { data: created, error: createError } = await job.supabase
      .from("properties")
      .insert({
        organization_id: job.organizationId,
        customer_id: job.customerId || null,
        address_line_1: address.value.line1,
        address_line_2: unit || null,
        city: address.value.city,
        state: address.value.state,
        postal_code: address.value.postalCode,
        access_notes: accessNotes || null,
      })
      .select("id")
      .maybeSingle();
    const propertyId = text(created?.id);
    if (createError || !propertyId) return { error: "That address could not be saved." };
    const { error: linkError } = await job.supabase
      .from("jobs")
      .update({ property_id: propertyId })
      .eq("id", job.id)
      .eq("organization_id", job.organizationId);
    if (linkError) return { error: "That address could not be saved." };
    await placeOnMap(propertyId);
    const filled = await fillDraftServiceAddress(job.supabase, job.organizationId, job.id, address.value);
    revalidatePath(`/jobs/${jobNumber}`);
    revalidatePath(`/jobs/${jobNumber}/edit`);
    revalidatePath("/route");
    return { error: "", notice: draftNote(filled, "Address saved", "Address saved.") };
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

  if (moved) await placeOnMap(job.propertyId);
  const filled = await fillDraftServiceAddress(job.supabase, job.organizationId, job.id, address.value);
  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  if (moved) revalidatePath("/route");
  return {
    error: "",
    notice: draftNote(filled, "Saved", "Saved. Every job at this address shows these."),
  };
}

/** Place a saved address on the map now, so arrival is picked up on the way there. Never fails the save. */
async function placeOnMap(propertyId: string) {
  const { placeProperty } = await import("@/lib/geocoding");
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
  await placeProperty({ database: getSupabaseAdmin(), propertyId }).catch(() => null);
}

/**
 * The service address, filled into the job's newest unsent draft contract
 * that was made without one ({{service_address}} still standing).
 *
 * As a new draft, the way completing a draft's details always works: a
 * contract's text is never changed in place. A draft that was sent, signed,
 * or already has an address is left exactly as it is. Its PDF is built again.
 */
async function fillDraftServiceAddress(
  supabase: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
  address: { line1: string; city: string; state: string; postalCode: string },
): Promise<"filled" | "stale" | "none"> {
  const { data } = await supabase
    .from("contracts")
    .select("id, kind, body, scope, status, signed_at, created_at, total_cents, deposit_cents, deposit_paid, organizations ( timezone )")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId)
    .neq("status", "void")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const draft = data as Record<string, unknown> | null;
  if (!draft || draft.status !== "draft" || draft.signed_at) return "none";
  const body = text(draft.body);
  if (!placeholdersUsed(body).includes("service_address")) return "none";

  // The copy keeps this draft's wording and is dated now, so it must not be
  // made after work this draft never listed: a line written since would read
  // as covered by a document that does not mention it, and later change
  // orders would leave it out (the same guard as completeContractDetails).
  const { count: writtenSince } = await supabase
    .from("job_line_items")
    .select("id", { count: "exact", head: true })
    .eq("job_id", jobId)
    .gt("created_at", text(draft.created_at));
  if (writtenSince) return "stale";

  const line = [address.line1, address.city, address.state, address.postalCode].filter(Boolean).join(", ");
  const filled = completeDraftFields(body, { service_address: line });
  const { data: created, error } = await supabase
    .from("contracts")
    .insert({
      organization_id: organizationId,
      job_id: jobId,
      kind: draft.kind === "change_order" ? "change_order" : "agreement",
      body: filled.body,
      scope: text(draft.scope),
      unfilled: filled.unfilled,
      status: "draft",
      total_cents: draft.total_cents ?? null,
      deposit_cents: draft.deposit_cents ?? null,
      deposit_paid: draft.deposit_paid ?? null,
    })
    .select("id")
    .maybeSingle();
  if (error || !created?.id) {
    console.error("filling the draft contract's address failed", { code: error?.code });
    return "none";
  }
  const { data: auth } = await supabase.auth.getUser();
  const organization = draft.organizations as Record<string, unknown> | null;
  const { generateContractPdf } = await import("@/lib/pdf/contract-data");
  await generateContractPdf({
    database: supabase,
    organizationId,
    contractId: text(created.id),
    timeZone: text(organization?.timezone) || "America/Los_Angeles",
    uploadedBy: auth.user?.id ?? "",
  }).catch(() => null);
  return "filled";
}

/** What the address save says about the draft contract. */
function draftNote(filled: "filled" | "stale" | "none", saved: string, otherwise: string): string {
  if (filled === "filled") return `${saved}, and added to the draft contract.`;
  if (filled === "stale") {
    return `${saved}. The draft contract was made before some of the job's items, so generate a new draft to include them and this address.`;
  }
  return otherwise;
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
