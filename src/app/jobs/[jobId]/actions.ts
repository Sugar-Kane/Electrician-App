"use server";

import { revalidatePath } from "next/cache";

import { changeNeedsCustomerNotice } from "@/lib/job-change-messages";
import { notifyJobChange } from "@/lib/job-notifications";
import { slotLabel, zonedWallClockToIso } from "@/lib/schedule-labels";
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

const STATUSES = new Set([
  "confirmed",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
  "completed",
  "no_show",
]);

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function name(customer: Record<string, unknown> | null): string {
  if (!customer) return "";
  const company = text(customer.company_name).trim();
  if (company) return company;
  return [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ").trim();
}

/** The job as the actions need it, found the way the pages link to it. */
async function loadJob(jobNumber: string) {
  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  if (!organizationId) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await supabase
    .from("jobs")
    .select(
      `id, status, scheduled_start, scheduled_end, arrival_window_start, arrival_window_end,
       organization_id, customers ( first_name, last_name, company_name, phone, email ),
       organizations ( name, phone, timezone )`,
    )
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!data) return null;

  // The relational select is wider than the generated types describe, so the
  // row is narrowed here rather than fought with.
  const row = data as Record<string, unknown>;
  const customer = (row.customers ?? null) as Record<string, unknown> | null;
  const organization = (row.organizations ?? null) as Record<string, unknown> | null;

  return {
    supabase,
    id: text(row.id),
    organizationId,
    status: text(row.status),
    start: text(row.arrival_window_start) || text(row.scheduled_start),
    end: text(row.arrival_window_end) || text(row.scheduled_end),
    timeZone: text(organization?.timezone) || "America/Los_Angeles",
    businessName: text(organization?.name) || "Your electrician",
    businessPhone: text(organization?.phone) || "our office",
    contactName: name(customer),
    customerPhone: text(customer?.phone),
    customerEmail: text(customer?.email),
  };
}

/**
 * Move a job, change its status, or both.
 *
 * The customer is told when the window moves, because that is the two hours
 * they took off work for. Reassigning who turns up is the business's own
 * business and sends nothing.
 */
export async function updateJob(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const startLocal = String(formData.get("start") ?? "").trim();
  const endLocal = String(formData.get("end") ?? "").trim();
  const status = String(formData.get("status") ?? "").trim();
  const notifyCustomer = formData.get("notifyCustomer") === "on";

  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };
  if (job.status === "canceled") {
    return { error: "This job is canceled. Cancelled jobs cannot be edited." };
  }
  if (status && !STATUSES.has(status)) return { error: "That is not a status a job can be in." };

  // datetime-local gives wall-clock time with no zone. Interpreting it in the
  // business's zone is what stops an 8am window becoming 8am UTC — which is
  // how the phone assistant once offered windows that had already passed.
  const start = startLocal ? zonedWallClockToIso(startLocal, job.timeZone) : job.start;
  const end = endLocal ? zonedWallClockToIso(endLocal, job.timeZone) : job.end;

  if (start && end && new Date(end) <= new Date(start)) {
    return { error: "The arrival window has to end after it starts." };
  }

  const patch: Record<string, unknown> = {};
  if (start) {
    patch.arrival_window_start = start;
    patch.scheduled_start = start;
  }
  if (end) {
    patch.arrival_window_end = end;
    patch.scheduled_end = end;
  }
  if (status) patch.status = status;

  if (Object.keys(patch).length === 0) return { error: "Nothing was changed." };

  const { data, error } = await job.supabase
    .from("jobs")
    .update(patch)
    .eq("id", job.id)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That change could not be saved." };
  }

  const moved = changeNeedsCustomerNotice({
    canceled: false,
    previousStart: job.start,
    nextStart: start,
    previousEnd: job.end,
    nextEnd: end,
  });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  revalidatePath("/schedule");

  if (!moved) return { error: "", notice: "Job updated." };
  if (!notifyCustomer) {
    return { error: "", notice: "Job moved. The customer was not told, as you asked." };
  }

  const attempts = await notifyJobChange({
    jobId: job.id,
    organizationId: job.organizationId,
    kind: "rescheduled",
    facts: {
      businessName: job.businessName,
      businessPhone: job.businessPhone,
      contactName: job.contactName,
      slotLabel: job.start && job.end ? slotLabel(job.start, job.end, job.timeZone) : "the old time",
      newSlotLabel: start && end ? slotLabel(start, end, job.timeZone) : undefined,
    },
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  });

  return { error: "", notice: `Job moved. ${describe(attempts)}` };
}

/**
 * Call a job off and tell the customer.
 *
 * The notification is the point of this action rather than a side effect: a
 * customer who is not told sits at home waiting for somebody who is never
 * coming, so the outcome of every send is reported back rather than assumed.
 */
export async function cancelJob(
  _previousState: JobActionState,
  formData: FormData,
): Promise<JobActionState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 500);

  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };
  if (job.status === "canceled") return { error: "That job is already canceled." };

  const { data, error } = await job.supabase
    .from("jobs")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    })
    .eq("id", job.id)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That job could not be canceled." };
  }

  const attempts = await notifyJobChange({
    jobId: job.id,
    organizationId: job.organizationId,
    kind: "canceled",
    facts: {
      businessName: job.businessName,
      businessPhone: job.businessPhone,
      contactName: job.contactName,
      slotLabel: job.start && job.end ? slotLabel(job.start, job.end, job.timeZone) : "your appointment",
      reason,
    },
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath(`/jobs/${jobNumber}/edit`);
  revalidatePath("/schedule");
  revalidatePath("/");

  return { error: "", notice: `Job canceled. ${describe(attempts)}` };
}

/**
 * What actually reached the customer, in words.
 *
 * Said plainly including when nothing arrived, because "canceled" on its own
 * reads as "and they know", which is the assumption this whole feature exists
 * to stop anybody making.
 */
function describe(attempts: { channel: string; ok: boolean; detail: string }[]): string {
  const sent = attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.channel);
  if (sent.length === 0) {
    const why = attempts[0]?.detail ?? "no contact details on file";
    return `The customer could NOT be told — ${why}`;
  }
  const failed = attempts.filter((attempt) => !attempt.ok);
  const good = `Customer notified by ${sent.join(" and ")}.`;
  return failed.length > 0 ? `${good} The ${failed[0]!.channel} did not go: ${failed[0]!.detail}` : good;
}
