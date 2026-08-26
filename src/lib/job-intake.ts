import "server-only";

import { readCallRecord, type CallRecord } from "@/lib/call-record";
import { type MessagingContext } from "@/lib/messaging";

/**
 * The booking request a job came from, read back for the job page.
 *
 * Takes the context the page has already built rather than resolving the
 * session again, the same way `getJobConversation` does — this is a third query
 * on a page that already makes eight, and a fourth auth round trip for it would
 * be waste.
 *
 * Scoped by organization on both statements. `created_job_id` is unique enough
 * on its own, but a read that depends on the id being unguessable is a read
 * that stops being safe the day something else starts handing ids out.
 */
export async function getJobIntake(
  context: MessagingContext,
  jobNumber: string,
): Promise<CallRecord | null> {
  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;

  const { data: job } = await context.database
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();

  const jobId = job?.id ? String(job.id) : "";
  if (!jobId) return null;

  const { data } = await context.database
    .from("booking_requests")
    .select(
      "communication_channel, created_by, created_at, description, intake_answers, urgency, arrival_window_start, arrival_window_end, deposit_cents",
    )
    .eq("organization_id", context.organizationId)
    .eq("created_job_id", jobId)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return readCallRecord(data);
}
