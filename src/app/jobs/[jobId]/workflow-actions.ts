"use server";

import { revalidatePath } from "next/cache";

import { sendJobEventMessage } from "@/lib/automatic-messages";
import {
  canAdvance,
  isWorkflowState,
  jobStatusFor,
  workflowStateOf,
  type WorkflowState,
} from "@/lib/job-workflow";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Moving a job to its next state, and remembering when.
 *
 * One action for the whole workflow rather than a status string per button. The
 * state machine decides whether a move is legal, so a stale page cannot post
 * "completed" at a job nobody has driven to, and the timestamps are written in
 * the same breath as the status — the pair is what a customer asking "what time
 * did he get here" is answered from.
 *
 * Everything goes through the caller's own session, so RLS decides whether this
 * job is theirs. The job number in the form is a lookup key, never an
 * authorisation.
 */

export type WorkflowActionState = {
  error: string;
  notice?: string;
  /** Set when the move landed, so the client can stop asking. */
  state?: WorkflowState;
};

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * The job, the caller, and who the timestamps belong to.
 *
 * The technician is the caller's own record when they have one — the person
 * holding the phone is the person who arrived. An office user without one falls
 * back to whoever the job is assigned to, because a dispatcher marking a job
 * arrived is recording that *the technician* arrived, not that they did. When
 * there is neither, the row is written unattributed rather than dropped: losing
 * the arrival time of the only person who went is the worse outcome, and an
 * owner-operator working alone often has no technician record at all.
 */
async function loadJob(jobNumber: string) {
  const supabase = asFlexibleClient(await createClient());

  const { data: auth } = await supabase.auth.getUser();
  const userId = auth.user?.id ?? "";
  if (!userId) return null;

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .limit(1)
    .maybeSingle();

  const organizationId = str(membership?.organization_id);
  if (!organizationId) return null;

  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data } = await supabase
    .from("jobs")
    .select("id, status, technician_id")
    .eq("organization_id", organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;

  const { data: mine } = await supabase
    .from("technicians")
    .select("id")
    .eq("organization_id", organizationId)
    .eq("user_id", userId)
    .maybeSingle();

  return {
    supabase,
    organizationId,
    id: str(row.id),
    status: str(row.status),
    technicianId: str(mine?.id) || str(row.technician_id) || null,
  };
}

type ProgressRow = {
  id: string;
  tripStartedAt: string;
  arrivedAt: string;
  workStartedAt: string;
};

/** What is already recorded for this technician on this job. */
async function loadProgress(
  job: NonNullable<Awaited<ReturnType<typeof loadJob>>>,
): Promise<ProgressRow | null> {
  const query = job.supabase
    .from("job_technician_progress")
    .select("id, trip_started_at, arrived_at, work_started_at")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id);

  // `is` rather than `eq` for the unattributed row: `eq(null)` matches nothing
  // in PostgREST, which would mint a second row on every tap.
  const { data } = job.technicianId
    ? await query.eq("technician_id", job.technicianId).maybeSingle()
    : await query.is("technician_id", null).maybeSingle();

  if (!data) return null;
  const row = data as Record<string, unknown>;

  return {
    id: str(row.id),
    tripStartedAt: str(row.trip_started_at),
    arrivedAt: str(row.arrived_at),
    workStartedAt: str(row.work_started_at),
  };
}

/**
 * Advance a job one step.
 *
 * `source` is only read when the move records an arrival, and only to separate
 * a time the app observed from a time somebody typed. Both are legitimate; a
 * dispute about an arrival window is not the moment to find out nobody recorded
 * which one it was.
 */
export async function advanceJob(
  _previous: WorkflowActionState,
  formData: FormData,
): Promise<WorkflowActionState> {
  const jobNumber = text(formData, "jobNumber");
  const requested = text(formData, "to");
  const source = text(formData, "source") === "geofence" ? "geofence" : "manual";

  if (!isWorkflowState(requested)) return { error: "That is not a step a job can take." };

  const job = await loadJob(jobNumber);
  if (!job) return { error: "That job could not be found." };

  const current = workflowStateOf(job.status);

  // The geofence and a tap can land within a second of each other, and a
  // refresh can replay a form. Arriving at the state you are already in is
  // success, not an error worth showing somebody.
  if (current === requested) return { error: "", state: current };

  if (current === "canceled") {
    return { error: "This job is canceled. Book a new visit instead." };
  }

  if (!canAdvance(current, requested)) {
    return { error: `A job that is ${current.replace(/_/g, " ")} cannot go straight to that step.` };
  }

  const now = new Date().toISOString();
  const progress = await loadProgress(job);

  // Only ever filled in, never overwritten. The first time somebody arrived is
  // the time they arrived; a second tap does not move it later.
  const patch: Record<string, unknown> = {};
  if (requested === "en_route" && !progress?.tripStartedAt) patch.trip_started_at = now;

  // Starting work from the van, without ever having been marked arrived. The
  // alternative is a job that is being worked on and has no arrival time at
  // all — see the confirm the screen shows before this happens.
  const recordsArrival =
    (requested === "arrived" || requested === "working") && !progress?.arrivedAt;

  if (recordsArrival) {
    patch.arrived_at = now;
    patch.arrival_source = requested === "arrived" ? source : "manual";
  }

  if (requested === "working" && !progress?.workStartedAt) patch.work_started_at = now;
  if (requested === "completed") patch.completed_at = now;

  const { error: statusError } = await job.supabase
    .from("jobs")
    .update({ status: jobStatusFor(requested) })
    .eq("id", job.id)
    .eq("organization_id", job.organizationId);

  if (statusError) return { error: "That could not be saved. Try again." };

  // The status is what the rest of the app reads, so it is written first and
  // the timestamps are best effort behind it. A progress row that fails to save
  // costs a time on a report; a status that fails to save strands somebody in
  // the wrong step.
  if (Object.keys(patch).length > 0) {
    if (progress) {
      await job.supabase
        .from("job_technician_progress")
        .update(patch)
        .eq("id", progress.id)
        .eq("organization_id", job.organizationId);
    } else {
      const { error: insertError } = await job.supabase
        .from("job_technician_progress")
        .insert({
          organization_id: job.organizationId,
          job_id: job.id,
          technician_id: job.technicianId,
          ...patch,
        });

      // Two taps in flight at once: the unique index refused the second. The
      // row it collided with is the one this was trying to create.
      if (insertError) {
        const existing = await loadProgress(job);
        if (existing) {
          await job.supabase
            .from("job_technician_progress")
            .update(patch)
            .eq("id", existing.id)
            .eq("organization_id", job.organizationId);
        }
      }
    }
  }

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/schedule");
  revalidatePath("/");

  if (recordsArrival) {
    const told = await tellCustomerAboutArrival(job, jobNumber);
    return { error: "", state: requested, notice: told };
  }

  return { error: "", state: requested };
}

/**
 * Tell the customer their electrician is here, at most once per job.
 *
 * Once per job rather than once per arrival: a technician who steps out for a
 * part and comes back has not arrived twice, and a customer who is texted twice
 * about the same visit is a customer who replies STOP. The guard is the whole
 * job's rows, not this technician's, so a second van does not send a second
 * message either.
 *
 * Everything about whether this is allowed at all — consent, quiet hours,
 * whether this business sends arrival texts — already lives in
 * `sendJobEventMessage`. Duplicating any of it here would be a second set of
 * rules to keep in step with the first.
 */
async function tellCustomerAboutArrival(
  job: NonNullable<Awaited<ReturnType<typeof loadJob>>>,
  jobNumber: string,
): Promise<string | undefined> {
  const { data: alreadyTold } = await job.supabase
    .from("job_technician_progress")
    .select("id")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id)
    .not("customer_notified_at", "is", null)
    .limit(1)
    .maybeSingle();

  if (alreadyTold) return undefined;

  const result = await sendJobEventMessage({ jobId: job.id, trigger: "job_arrived" });
  if (!result.sent) return undefined;

  const { data: mine } = await job.supabase
    .from("job_technician_progress")
    .select("id")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id)
    .not("arrived_at", "is", null)
    .order("arrived_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mine) {
    await job.supabase
      .from("job_technician_progress")
      .update({ customer_notified_at: new Date().toISOString() })
      .eq("id", str((mine as Record<string, unknown>).id))
      .eq("organization_id", job.organizationId);
  }

  revalidatePath(`/jobs/${jobNumber}`);
  return "Customer told you have arrived.";
}
