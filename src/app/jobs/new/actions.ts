"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { parseNewJob, splitName, type NewJobRaw } from "@/lib/new-job-input";
import { zonedWallClockToIso } from "@/lib/schedule-labels";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Creating a job by hand.
 *
 * Everything is written through the caller's session, so RLS decides which
 * organization these rows may belong to — the organization id is read from the
 * caller's own membership and never accepted from the form.
 *
 * Up to four rows come out of one submission: a customer, a property, the job,
 * and an invoice if a cost was given. They are created in that order because
 * each needs the one before it, and a failure part-way leaves the earlier rows
 * in place rather than rolling back. That is deliberate — a customer record
 * with no job is a mild nuisance, and losing a customer's details because the
 * scheduled time was malformed would make somebody retype the whole thing.
 */

export type NewJobState = { error: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function field(formData: FormData, name: string): string {
  return String(formData.get(name) ?? "");
}

export async function createJob(
  _previousState: NewJobState,
  formData: FormData,
): Promise<NewJobState> {
  const raw: NewJobRaw = {
    customerName: field(formData, "customerName"),
    phone: field(formData, "phone"),
    email: field(formData, "email"),
    addressLine1: field(formData, "addressLine1"),
    city: field(formData, "city"),
    state: field(formData, "state"),
    postalCode: field(formData, "postalCode"),
    category: field(formData, "category"),
    description: field(formData, "description"),
    startLocal: field(formData, "startLocal"),
    durationHours: field(formData, "durationHours"),
    cost: field(formData, "cost"),
  };

  const parsed = parseNewJob(raw);
  if (!parsed.ok) return { error: parsed.error };
  const job = parsed.value;

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) {
    return { error: "You are not a member of a business, so there is nowhere to file this job." };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();

  const timeZone = text(organization?.timezone) || "America/Los_Angeles";

  // An existing customer is reused rather than duplicated. Somebody who has
  // called twice is one customer with two jobs, and a second record splits
  // their history in half — which is how a business ends up texting the same
  // person from two threads.
  let customerId = "";
  if (job.phone) {
    const { data: existing } = await supabase
      .from("customers")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("phone", job.phone)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();
    customerId = text(existing?.id);
  }

  if (!customerId) {
    const { firstName, lastName } = splitName(job.customerName);
    const { data: created, error } = await supabase
      .from("customers")
      .insert({
        organization_id: organizationId,
        first_name: firstName || null,
        last_name: lastName || null,
        phone: job.phone || null,
        email: job.email || null,
        preferred_contact: job.phone ? "sms" : "email",
      })
      .select("id")
      .maybeSingle();

    if (error || !created) {
      return { error: "That customer could not be saved. Nothing was created." };
    }
    customerId = text(created.id);
  }

  let propertyId: string | null = null;
  if (job.address) {
    const { data: existingProperty } = await supabase
      .from("properties")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("address_line_1", job.address.line1)
      .is("archived_at", null)
      .limit(1)
      .maybeSingle();

    propertyId = text(existingProperty?.id) || null;

    if (!propertyId) {
      const { data: created } = await supabase
        .from("properties")
        .insert({
          organization_id: organizationId,
          customer_id: customerId,
          address_line_1: job.address.line1,
          city: job.address.city,
          state: job.address.state,
          postal_code: job.address.postalCode,
        })
        .select("id")
        .maybeSingle();

      // Deliberately not fatal. A job without a property is a job that will not
      // appear on the map, which is far better than refusing to record work
      // that is genuinely happening.
      propertyId = text(created?.id) || null;
    }
  }

  // datetime-local is wall-clock with no zone. Reading it in the business's own
  // zone is what stops an 8am visit becoming 8am UTC — the same fault that once
  // had the phone assistant offering windows that had already passed.
  const start = job.startLocal ? zonedWallClockToIso(job.startLocal, timeZone) : "";
  const end = start
    ? new Date(new Date(start).getTime() + job.durationMinutes * 60_000).toISOString()
    : "";

  const { data: createdJob, error: jobError } = await supabase
    .from("jobs")
    .insert({
      organization_id: organizationId,
      customer_id: customerId,
      property_id: propertyId,
      category: job.category,
      customer_description: job.description || null,
      // Scheduled if it has a time, still a draft if it does not — a job with
      // no time that claimed to be confirmed would sit in the schedule as a
      // promise nobody made.
      status: start ? "confirmed" : "draft",
      ...(start ? { scheduled_start: start, arrival_window_start: start } : {}),
      ...(end ? { scheduled_end: end, arrival_window_end: end } : {}),
    })
    .select("id, job_number")
    .maybeSingle();

  if (jobError || !createdJob) {
    return { error: "That job could not be saved. The customer was kept." };
  }

  if (job.costCents > 0) {
    await supabase.from("invoices").insert({
      organization_id: organizationId,
      job_id: text(createdJob.id),
      // Draft, not sent: raising an invoice and telling the customer about it
      // are two decisions, and the second one has its own button.
      status: "draft",
      subtotal_cents: job.costCents,
      total_cents: job.costCents,
      balance_due_cents: job.costCents,
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/invoices");
  revalidatePath("/");

  redirect(`/jobs/${String(createdJob.job_number ?? "")}`);
}
