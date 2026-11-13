"use server";

import { revalidatePath } from "next/cache";

import { advanceVisit } from "@/lib/job-changes-server";
import { isWorkflowState, type WorkflowState } from "@/lib/job-workflow";
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

  // What was actually used from stock for each reserved line, as
  // `used:<line id>`; a line the form does not mention used what it asked for.
  const confirmed = new Map<string, number | null>();
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("used:")) continue;
    const typed = String(value).trim();
    const amount = Number(typed);
    // Blank, or anything that is not a number, is "none from stock".
    confirmed.set(key.slice("used:".length), typed && Number.isFinite(amount) ? amount : 0);
  }

  // Finish work's "tell the customer": how, and by which channels.
  const noticeMode = text(formData, "noticeMode");
  const completionNotice =
    requested === "completed" && (noticeMode === "none" || noticeMode === "notice" || noticeMode === "details")
      ? { mode: noticeMode as "none" | "notice" | "details", sms: text(formData, "noticeSms") === "on", email: text(formData, "noticeEmail") === "on" }
      : undefined;

  const result = await advanceVisit(job, { requested, source, confirmed, completionNotice });
  if (result.error || !result.state) return { error: result.error, state: result.state };

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/schedule");
  revalidatePath("/");

  // A finished job is no longer written up on its own: each write-up costs
  // built-in AI whether anybody reads it or not. The owner writes the ones
  // they want from Settings → Journal, where every finished job is offered.
  if (result.finished) {
    revalidatePath("/inventory");
    revalidatePath("/materials");
  }

  return { error: "", state: result.state, notice: result.notice };
}
