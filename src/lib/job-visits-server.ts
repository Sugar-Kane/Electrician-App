import "server-only";

import { recordActivity } from "@/lib/activity";
import { changeJob, type ChangeJob } from "@/lib/job-changes-server";
import { jobStatusFor, workflowStateOf } from "@/lib/job-workflow";

/**
 * A job's visits: the ones it has had, and ending today's with the job still
 * open.
 *
 * The job always describes the visit that is next or under way: its window on
 * `jobs`, its times in `job_technician_progress`. That is what the schedule,
 * the customer texts and the workflow already read, so they keep working for a
 * second and third visit without knowing there was a first. Ending a visit
 * copies it to `job_visits`, clears the progress times for the next trip, and
 * books the job again.
 */

export type PastVisit = {
  id: string;
  windowStart: string;
  windowEnd: string;
  arrivedAt: string;
  workStartedAt: string;
  endedAt: string;
  note: string;
};

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

export async function getJobVisits(job: { supabase: ChangeJob["supabase"]; organizationId: string; id: string }): Promise<PastVisit[]> {
  const { data } = await job.supabase
    .from("job_visits")
    .select("id, arrival_window_start, arrival_window_end, arrived_at, work_started_at, ended_at, note")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id)
    .order("ended_at", { ascending: true });
  return ((data ?? []) as Record<string, unknown>[]).map((row) => ({
    id: text(row.id),
    windowStart: text(row.arrival_window_start),
    windowEnd: text(row.arrival_window_end),
    arrivedAt: text(row.arrived_at),
    workStartedAt: text(row.work_started_at),
    endedAt: text(row.ended_at),
    note: text(row.note),
  }));
}

const ON_SITE = new Set(["arrived", "working", "review"]);

const PROGRESS_CLEARED = {
  trip_started_at: null,
  arrived_at: null,
  arrival_source: null,
  work_started_at: null,
  completed_at: null,
  customer_en_route_notified_at: null,
  customer_arrival_notified_at: null,
};

/**
 * End the visit under way and book the next one.
 *
 * With a new window the job goes back to Scheduled for it, and the customer is
 * told the way any moved appointment is (consent and quiet hours decided where
 * every text is). Without one it waits for a time, like a job never booked.
 */
export async function endVisitForReturn(
  job: ChangeJob,
  input: { startLocal: string; endLocal: string; note: string; notifyCustomer: boolean; userId: string },
): Promise<{ error: string; notice?: string }> {
  const state = workflowStateOf(job.status);
  if (!ON_SITE.has(state)) {
    return { error: "A visit can only be ended for a return once you are on site." };
  }
  if (input.startLocal && !input.endLocal) return { error: "Add when the arrival window ends." };
  const note = input.note.trim().slice(0, 2000);

  const { data: progressRows } = await job.supabase
    .from("job_technician_progress")
    .select("id, technician_id, trip_started_at, arrived_at, work_started_at")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id);
  const rows = (progressRows ?? []) as Record<string, unknown>[];
  const mine = rows.find((row) => text(row.technician_id) === (job.technicianId ?? "")) ?? rows[0] ?? {};
  const arrivedAt = text(mine.arrived_at) || null;

  // A retry after a failed reschedule must not write the same visit twice.
  let already = false;
  if (arrivedAt) {
    const { data: existing } = await job.supabase
      .from("job_visits")
      .select("id")
      .eq("organization_id", job.organizationId)
      .eq("job_id", job.id)
      .eq("arrived_at", arrivedAt)
      .limit(1);
    already = Array.isArray(existing) && existing.length > 0;
  }

  if (!already) {
    const { error: insertError } = await job.supabase.from("job_visits").insert({
      organization_id: job.organizationId,
      job_id: job.id,
      technician_id: job.technicianId,
      arrival_window_start: job.start || null,
      arrival_window_end: job.end || null,
      trip_started_at: text(mine.trip_started_at) || null,
      arrived_at: arrivedAt,
      work_started_at: text(mine.work_started_at) || null,
      note,
      ended_by: input.userId || null,
    });
    if (insertError) return { error: "The visit could not be saved, so nothing was changed. Try again." };
  }

  let notice = "";
  if (input.startLocal) {
    const result = await changeJob(job, {
      startLocal: input.startLocal,
      endLocal: input.endLocal,
      status: jobStatusFor("scheduled"),
      notifyCustomer: input.notifyCustomer,
    });
    if (result.error) return { error: result.error };
    notice = result.notice ?? "";
  } else {
    const { data, error } = await job.supabase
      .from("jobs")
      .update({
        status: jobStatusFor("scheduled"),
        scheduled_start: null,
        scheduled_end: null,
        arrival_window_start: null,
        arrival_window_end: null,
      })
      .eq("id", job.id)
      .eq("organization_id", job.organizationId)
      .select("id");
    if (error || !Array.isArray(data) || data.length === 0) {
      return { error: "The visit was saved, but the job could not be reopened. Try again." };
    }
  }

  // The next trip records its own times and texts, so the last one's are cleared.
  if (rows.length > 0) {
    await job.supabase
      .from("job_technician_progress")
      .update(PROGRESS_CLEARED)
      .eq("organization_id", job.organizationId)
      .eq("job_id", job.id);
  }

  await recordActivity(job.supabase, {
    organizationId: job.organizationId,
    eventType: "job.visit_ended",
    label: input.startLocal ? "Visit ended, return visit booked" : "Visit ended, return visit to schedule",
    jobId: job.id,
    metadata: note ? { note } : {},
  });

  return {
    error: "",
    notice: input.startLocal
      ? `Visit saved and the return visit is booked.${notice ? ` ${notice}` : ""}`
      : "Visit saved. Set a time for the return visit when you know it.",
  };
}

/** The job's past visits by its number, read under the signed-in person's own access. */
export async function getJobVisitsByNumber(jobNumber: string): Promise<PastVisit[]> {
  const { asFlexibleClient } = await import("@/lib/supabase/flexible");
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = asFlexibleClient(await createClient());
  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return [];
  const { data: membership } = await supabase.from("organization_members").select("organization_id").limit(1).maybeSingle();
  const organizationId = text(membership?.organization_id);
  if (!organizationId) return [];
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();
  if (!job) return [];
  return getJobVisits({ supabase, organizationId, id: text((job as Record<string, unknown>).id) });
}
