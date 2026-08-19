import "server-only";

import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Writing down that something happened.
 *
 * One writer for the whole app, so a customer's history is not a matter of
 * which developer remembered. Three rules, and each of them is the reason this
 * is a function rather than an inline insert:
 *
 * 1. **It never throws.** A timeline is a record of work, not the work. A failed
 *    insert here must not fail the payment, the status change or the invoice it
 *    was describing — that would be losing the thing to protect the note about
 *    the thing.
 * 2. **It passes what it knows and no more.** A `before insert` trigger fills in
 *    the customer from the job, and the booking request from either, so a caller
 *    holding only a job id writes a complete row anyway.
 * 3. **The label is a fallback.** `activity-timeline.ts` owns the wording, keyed
 *    on the event type. What is stored here is what to say if that file has not
 *    heard of this event yet.
 */

export type ActivityInput = {
  organizationId: string;
  /** `booking.fee_accepted`, `job.completed` — the vocabulary in activity-timeline.ts. */
  eventType: string;
  /** Plain words, used only if the timeline does not know this event type. */
  label: string;
  customerId?: string | null;
  jobId?: string | null;
  bookingRequestId?: string | null;
  actorUserId?: string | null;
  /** `amount_cents`, `via`, `note` are read by the timeline; anything else is kept. */
  metadata?: Record<string, unknown>;
};

export async function recordActivity(
  database: FlexibleSupabaseClient,
  input: ActivityInput,
): Promise<void> {
  if (!input.organizationId || !input.eventType) return;

  const { error } = await database.from("activity_events").insert({
    organization_id: input.organizationId,
    event_type: input.eventType,
    label: input.label,
    customer_id: input.customerId ?? null,
    job_id: input.jobId ?? null,
    booking_request_id: input.bookingRequestId ?? null,
    actor_user_id: input.actorUserId ?? null,
    // Kept in step with the columns the app read before they existed, so
    // anything still filtering on entity_type finds these rows too.
    entity_type: input.jobId ? "job" : input.customerId ? "customer" : null,
    entity_id: input.jobId ?? input.customerId ?? null,
    metadata: input.metadata ?? {},
  });

  if (error) {
    // Logged, not raised. See rule 1.
    console.error(`activity: could not record ${input.eventType}`, error);
  }
}
