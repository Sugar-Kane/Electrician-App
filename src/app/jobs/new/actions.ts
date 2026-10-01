"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { invoiceTotals } from "@/lib/invoice-math";
import {
  kindOfWork,
  parseNewJob,
  splitName,
  workOrderTotalCents,
  type NewJobRaw,
} from "@/lib/new-job-input";
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

/**
 * What the form gets back.
 *
 * `values` is the whole submission, returned on every failure. Without it React
 * resets an uncontrolled form when the action settles, so a mistyped price
 * emptied the customer's name, phone, address and description as well — half a
 * minute of typing gone over a stray full stop. The form feeds these straight
 * back in, so a rejected save leaves the screen exactly as it was, with one
 * sentence saying what to fix.
 */
export type NewJobState = { error: string; values?: NewJobRaw };

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
    addressLine2: field(formData, "addressLine2"),
    city: field(formData, "city"),
    state: field(formData, "state"),
    postalCode: field(formData, "postalCode"),
    accessNotes: field(formData, "accessNotes"),
    category: field(formData, "category"),
    description: field(formData, "description"),
    startLocal: field(formData, "startLocal"),
    durationHours: field(formData, "durationHours"),
    cost: field(formData, "cost"),
    mode: field(formData, "mode"),
    workOrderLines: field(formData, "workOrderLines"),
  };

  /** Everything typed, handed back so nothing is lost to a rejected save. */
  const keep = (error: string): NewJobState => ({ error, values: raw });

  const parsed = parseNewJob(raw);
  if (!parsed.ok) return keep(parsed.error);
  const job = parsed.value;
  const draft = job.mode === "draft";

  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) {
    return keep("You are not a member of a business, so there is nowhere to file this job.");
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("timezone")
    .eq("id", organizationId)
    .maybeSingle();

  const timeZone = text(organization?.timezone) || "America/Los_Angeles";

  /*
   * The diagnostic this is booked from, when it is.
   *
   * Looked up through the caller's own client, so it has to be a job of their
   * business, and it has to be a diagnostic that was not called off — the same
   * rule as the page that offered to book it. Refused rather than saved
   * unlinked: a work order that silently lost its diagnostic also loses the
   * fee the customer was told would come off it.
   */
  const followUpNumber = Number(field(formData, "followUpOf").trim() || Number.NaN);
  let followed: { id: string; customerId: string } | null = null;
  if (Number.isInteger(followUpNumber) && followUpNumber > 0) {
    const { data: diagnostic } = await supabase
      .from("jobs")
      .select("id, category, status, customer_id")
      .eq("organization_id", organizationId)
      .eq("job_number", followUpNumber)
      .is("archived_at", null)
      .maybeSingle();

    if (
      !diagnostic ||
      diagnostic.status === "canceled" ||
      kindOfWork(text(diagnostic.category)) !== "Diagnostic"
    ) {
      return keep(`Diagnostic #${followUpNumber} could not be found, so nothing was booked from it.`);
    }
    followed = { id: text(diagnostic.id), customerId: text(diagnostic.customer_id) };
  }

  // An existing customer is reused rather than duplicated. Somebody who has
  // called twice is one customer with two jobs, and a second record splits
  // their history in half — which is how a business ends up texting the same
  // person from two threads.
  //
  // Matched on the last ten digits, through the same function the phone and
  // text intake use, because that is how the unique index compares numbers.
  // Most customers' phones are stored as first written, "(805) 555-0142", so
  // an exact match on "+18055550142" missed them, and the insert that followed
  // collided with them: a new job for a returning customer could not be saved.
  let customerId = "";
  if (job.phone) {
    const { firstName, lastName } = splitName(job.customerName);
    const { data: found, error } = await supabase.rpc("find_or_create_customer_by_phone", {
      p_organization_id: organizationId,
      p_phone: job.phone,
      p_first_name: firstName || job.customerName,
      p_last_name: lastName || null,
      p_preferred_contact: "sms",
    });

    if (error || !text(found)) {
      console.error("new job: the customer could not be found or saved", error);
      return keep("That customer could not be saved. Nothing was created.");
    }
    customerId = text(found);

    // The email typed goes on a new customer. A returning one keeps theirs.
    if (job.email) {
      const { error: emailError } = await supabase
        .from("customers")
        .update({ email: job.email })
        .eq("id", customerId)
        .is("email", null);
      if (emailError) console.error("new job: the email could not be added", emailError);
    }
  }

  // Booked from a diagnostic with no phone on it: the diagnostic's customer.
  // There is nothing to match an email-only customer on, and a second record
  // for them would split their history between this job and the last.
  if (!customerId && !job.phone && followed?.customerId) customerId = followed.customerId;

  // No phone: a customer reachable by email only, who has nothing to match on.
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
      console.error("new job: the customer could not be saved", error);
      return keep("That customer could not be saved. Nothing was created.");
    }
    customerId = text(created.id);
  }

  /*
   * A draft may have half an address, and half an address is still worth
   * keeping — a street with no ZIP is enough to find the house again on
   * Tuesday. The columns are `not null` with no length check, so the parts that
   * are missing are stored empty rather than as a refusal to save anything.
   */
  let propertyId: string | null = null;
  if (job.address) {
    // The same place means the same street *and* the same unit. A landlord's
    // Apt 1 and Apt 2 share a street, and a gate code, but not a door.
    const sameStreet = supabase
      .from("properties")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("customer_id", customerId)
      .eq("address_line_1", job.address.line1)
      .is("archived_at", null);
    const { data: existingProperty } = await (job.address.line2
      ? sameStreet.eq("address_line_2", job.address.line2)
      : sameStreet.or("address_line_2.is.null,address_line_2.eq."))
      .limit(1)
      .maybeSingle();

    propertyId = text(existingProperty?.id) || null;

    if (propertyId && job.accessNotes) {
      // The notes typed now are the newest word on the place, so they replace
      // what was kept. Left blank, the kept notes stand. Not fatal either way:
      // the job matters more than its notes.
      const { error } = await supabase
        .from("properties")
        .update({ access_notes: job.accessNotes })
        .eq("id", propertyId);
      if (error) console.error("new job: the access notes could not be updated", error);
    }

    if (!propertyId) {
      const { data: created } = await supabase
        .from("properties")
        .insert({
          organization_id: organizationId,
          customer_id: customerId,
          address_line_1: job.address.line1,
          address_line_2: job.address.line2 || null,
          city: job.address.city,
          state: job.address.state,
          postal_code: job.address.postalCode,
          access_notes: job.accessNotes || null,
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
      /*
       * A draft stays a draft even with a time on it, because the owner said
       * so. Otherwise: scheduled if it has a time, a draft if it does not — a
       * job with no time that claimed to be confirmed would sit in the schedule
       * as a promise nobody made.
       */
      status: draft || !start ? "draft" : "confirmed",
      ...(start ? { scheduled_start: start, arrival_window_start: start } : {}),
      ...(end ? { scheduled_end: end, arrival_window_end: end } : {}),
      // A follow-up has no diagnostic fee of its own. The one the customer
      // paid belongs to the visit it follows, and is credited from there.
      ...(followed ? { follow_up_of: followed.id, diagnostic_fee_cents: 0 } : {}),
    })
    .select("id, job_number")
    .maybeSingle();

  if (jobError || !createdJob) {
    console.error("new job: the job row could not be saved", jobError);
    return keep("That job could not be saved. The customer was kept.");
  }

  // Every job now leaves a record of where it came from, so Reports can answer
  // "how much of my work arrives by text, and how much do I write down myself".
  // Owner-entered work arrives already decided, so it is written as resolved —
  // it must never appear in Needs attention as something to action, and the
  // table has a constraint that refuses an owner row in an open state.
  //
  // Deliberately not failing the job if this insert does: the job is the thing
  // the electrician asked for, and losing it to a bookkeeping row would be a
  // poor trade.
  await supabase.from("booking_requests").insert({
    organization_id: organizationId,
    source: "owner",
    status: "scheduled",
    intent: start ? "visit" : "callback",
    phone: job.phone || "not recorded",
    contact_name: job.customerName || null,
    description: job.description || "Entered by the business.",
    customer_id: customerId,
    property_id: propertyId,
    created_job_id: createdJob.id,
    category: job.category,
    ...(start ? { arrival_window_start: start } : {}),
    ...(end ? { arrival_window_end: end } : {}),
  });

  /*
   * The work order's lines.
   *
   * Written after the job because each row needs its id. Not fatal if they
   * fail: the job is the thing that was asked for, and a parts list can be
   * retyped on the job page, where it also lives.
   */
  if (job.lines.length > 0) {
    const { error: lineError } = await supabase.from("job_line_items").insert(
      job.lines.map((line) => ({
        organization_id: organizationId,
        job_id: text(createdJob.id),
        kind: line.kind,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        unit_price_cents: line.unitPriceCents,
      })),
    );

    if (lineError) console.error("new job: the work order lines could not be saved", lineError);
  }

  /*
   * A typed cost wins over the lines.
   *
   * Somebody who itemised the work and then typed a round number has quoted
   * that round number, and an invoice that silently disagreed with the figure
   * on screen would be the worst kind of surprise.
   */
  const subtotalCents = job.costCents > 0 ? job.costCents : workOrderTotalCents(job.lines);

  if (subtotalCents > 0) {
    // A job created here has no paid diagnostic behind it — it is being
    // written down after the fact, and nothing has been collected yet. Unless
    // it is the work a paid diagnostic found, which is what that fee was
    // promised against: then whatever of it has not come off yet comes off
    // this, the work order's first invoice.
    const diagnosticPaidCents = followed
      ? await diagnosticCreditLeft(supabase, organizationId, {
          id: text(createdJob.id),
          followUpOf: followed.id,
          diagnosticPaid: false,
          diagnosticFeeCents: 0,
        })
      : 0;
    const totals = invoiceTotals({ subtotalCents, diagnosticPaidCents });

    await supabase.from("invoices").insert({
      organization_id: organizationId,
      job_id: text(createdJob.id),
      // Draft, not sent: raising an invoice and telling the customer about it
      // are two decisions, and the second one has its own button.
      status: "draft",
      subtotal_cents: totals.subtotalCents,
      diagnostic_credit_cents: totals.diagnosticCreditCents,
      tax_cents: totals.taxCents,
      total_cents: totals.totalCents,
      balance_due_cents: totals.totalCents,
      stripe_application_fee_cents: totals.applicationFeeCents,
    });
  }

  revalidatePath("/schedule");
  revalidatePath("/invoices");
  revalidatePath("/");
  if (followed) revalidatePath(`/jobs/${followUpNumber}`);

  redirect(`/jobs/${String(createdJob.job_number ?? "")}`);
}
