import "server-only";

import { recordActivity } from "@/lib/activity";
import { sendJobEventMessage } from "@/lib/automatic-messages";
import { returnStock, takeReservedParts } from "@/lib/job-billing-server";
import { changeNeedsCustomerNotice } from "@/lib/job-change-messages";
import { notifyJobChange } from "@/lib/job-notifications";
import {
  canAdvance,
  isWorkflowState,
  jobStatusFor,
  workflowStateOf,
  type WorkflowState,
} from "@/lib/job-workflow";
import { slotLabel, zonedWallClockToIso } from "@/lib/schedule-labels";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Moving a job, calling it off, and taking it through the visit.
 *
 * The job page and ChatGPT both change jobs through here, so there is one set
 * of rules for both: who is told and when, parts reserved for a job coming off
 * the count when it is finished and going back when it is canceled, and a
 * status a job cannot jump to being refused.
 *
 * Every read and write goes through the client the caller passes, scoped to
 * the caller's business. The customer is only told once a change has been
 * saved, so a failed write can never send a text about something that did not
 * happen.
 */

export type JobChangeResult = { error: string; notice?: string };

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function name(customer: Record<string, unknown> | null): string {
  if (!customer) return "";
  const company = text(customer.company_name).trim();
  if (company) return company;
  return [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ").trim();
}

export type ChangeJob = NonNullable<Awaited<ReturnType<typeof loadChangeJob>>>;

/** The job as a change needs it, by its number within the business. */
export async function loadChangeJob(
  supabase: FlexibleSupabaseClient,
  organizationId: string,
  jobNumber: string,
) {
  const numeric = Number(jobNumber);
  if (!organizationId || !Number.isFinite(numeric)) return null;

  const { data } = await supabase
    .from("jobs")
    .select(
      `id, status, property_id, customer_id, technician_id, scheduled_start, scheduled_end, arrival_window_start, arrival_window_end,
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
    propertyId: text(row.property_id),
    customerId: text(row.customer_id),
    technicianId: text(row.technician_id) || null,
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
 * What actually reached the customer, in words.
 *
 * Said plainly including when nothing arrived, because "canceled" on its own
 * reads as "and they know", which is the assumption this whole feature exists
 * to stop anybody making.
 */
export function describeAttempts(attempts: { channel: string; ok: boolean; detail: string }[]): string {
  const sent = attempts.filter((attempt) => attempt.ok).map((attempt) => attempt.channel);
  if (sent.length === 0) {
    const why = attempts[0]?.detail ?? "no contact details on file";
    return `The customer could NOT be told — ${why}`;
  }
  const failed = attempts.filter((attempt) => !attempt.ok);
  const good = `Customer notified by ${sent.join(" and ")}.`;
  return failed.length > 0 ? `${good} The ${failed[0]!.channel} did not go: ${failed[0]!.detail}` : good;
}

const EDIT_STATUSES = new Set([
  "draft",
  "confirmed",
  "assigned",
  "en_route",
  "arrived",
  "in_progress",
  "completed",
  "no_show",
]);

/**
 * Move a job's window and/or set its status, telling the customer when the
 * time moved and the caller asked for that.
 */
export async function changeJob(
  job: ChangeJob,
  input: { startLocal: string; endLocal: string; status: string; notifyCustomer: boolean },
): Promise<JobChangeResult & { partsUsed?: string[] }> {
  if (job.status === "canceled") {
    return { error: "This job is canceled. Cancelled jobs cannot be edited." };
  }
  const status = input.status;
  if (status && !EDIT_STATUSES.has(status)) return { error: "That is not a status a job can be in." };

  // datetime-local gives wall-clock time with no zone. Interpreting it in the
  // business's zone is what stops an 8am window becoming 8am UTC — which is
  // how the phone assistant once offered windows that had already passed.
  const start = input.startLocal ? zonedWallClockToIso(input.startLocal, job.timeZone) : job.start;
  const end = input.endLocal ? zonedWallClockToIso(input.endLocal, job.timeZone) : job.end;

  if ((input.startLocal && !start) || (input.endLocal && !end)) {
    return { error: "That time could not be read." };
  }
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
  // A job given a time is scheduled, the same as a new job saved with one
  // (app/jobs/new/actions.ts): "Not scheduled" with a time set is never kept.
  if (start && (patch.status ?? job.status) === "draft") patch.status = "confirmed";

  if (Object.keys(patch).length === 0) return { error: "Nothing was changed." };

  /*
   * Marked completed from here rather than through the visit steps: its
   * reserved parts come off the count as asked for, the same as finishing it
   * there without changing any numbers. Before the status, so a failure leaves
   * the job open with its parts still reserved.
   */
  let partsUsed: string[] = [];
  if (status === "completed" && job.status !== "completed") {
    const parts = await takeReservedParts(job.supabase, { organizationId: job.organizationId, jobId: job.id });
    if (!parts.ok) {
      return { error: "The job's parts could not be taken off the stock count, so it was not marked completed. Try again." };
    }
    partsUsed = parts.said;
  }

  const { data, error } = await job.supabase
    .from("jobs")
    .update(patch)
    .eq("id", job.id)
    .eq("organization_id", job.organizationId)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That change could not be saved." };
  }

  // Marking a job done is not moving it: the customer is never told a
  // finished visit has a new time.
  const finishing = status === "completed" && job.status !== "completed";
  const moved = !finishing && changeNeedsCustomerNotice({
    canceled: false,
    previousStart: job.start,
    nextStart: start,
    previousEnd: job.end,
    nextEnd: end,
  });

  if (finishing) {
    // The business's "Work complete" message, if it sends one — not a move.
    const told = await sendJobEventMessage({ jobId: job.id, trigger: "job_completed" });
    return {
      error: "",
      notice: ["Job completed.", told.sent ? "Customer told the work is complete." : "", ...partsUsed].filter(Boolean).join(" "),
      partsUsed,
    };
  }
  if (!moved) return { error: "", notice: ["Job updated.", ...partsUsed].join(" "), partsUsed };
  if (!input.notifyCustomer) {
    return { error: "", notice: "Job moved. The customer was not told, as you asked.", partsUsed };
  }

  const attempts = await notifyJobChange({
    jobId: job.id,
    organizationId: job.organizationId,
    kind: "rescheduled",
    facts: {
      businessName: job.businessName,
      businessPhone: job.businessPhone,
      contactName: job.contactName,
      slotLabel: job.start && job.end ? slotLabel(job.start, job.end, job.timeZone) : "",
      newSlotLabel: start && end ? slotLabel(start, end, job.timeZone) : undefined,
    },
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  });

  return { error: "", notice: `Job moved. ${describeAttempts(attempts)}`, partsUsed };
}

/**
 * Call a job off and tell the customer.
 *
 * The notification is the point of this rather than a side effect: a customer
 * who is not told sits at home waiting for somebody who is never coming, so
 * the outcome of every send is reported back rather than assumed.
 */
export async function callOffJob(
  job: ChangeJob,
  reasonInput: string,
): Promise<JobChangeResult & { restocked?: number }> {
  const reason = reasonInput.trim().slice(0, 500);
  if (job.status === "canceled") return { error: "That job is already canceled." };

  const { data, error } = await job.supabase
    .from("jobs")
    .update({
      status: "canceled",
      canceled_at: new Date().toISOString(),
      cancellation_reason: reason || null,
    })
    .eq("id", job.id)
    .eq("organization_id", job.organizationId)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That job could not be canceled." };
  }

  /*
   * Parts taken from inventory for a job that is not happening go back on the
   * count. They were written down against this job — at booking, or on the
   * job page — and left out they would sit "used" on a job that never ran,
   * with the job's page, where they could be removed, now closed.
   */
  const { data: stockLines } = await job.supabase
    .from("job_line_items")
    .select("id")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id)
    .not("inventory_item_id", "is", null);
  const returned = await returnStock(job.supabase, {
    organizationId: job.organizationId,
    jobId: job.id,
    lineIds: ((stockLines ?? []) as Record<string, unknown>[]).map((line) => String(line.id)),
    note: "The job was canceled.",
  });
  const restocked =
    returned > 0 ? ` ${returned} ${returned === 1 ? "part" : "parts"} went back into inventory.` : "";

  const attempts = await notifyJobChange({
    jobId: job.id,
    organizationId: job.organizationId,
    kind: "canceled",
    facts: {
      businessName: job.businessName,
      businessPhone: job.businessPhone,
      contactName: job.contactName,
      slotLabel: job.start && job.end ? slotLabel(job.start, job.end, job.timeZone) : "",
      reason,
    },
    customerPhone: job.customerPhone,
    customerEmail: job.customerEmail,
  });

  return { error: "", notice: `Job canceled. ${describeAttempts(attempts)}${restocked}`, restocked: returned };
}

/** The job as a step of the visit needs it. */
export type VisitJob = {
  supabase: FlexibleSupabaseClient;
  organizationId: string;
  id: string;
  status: string;
  technicianId: string | null;
};

type ProgressRow = {
  id: string;
  tripStartedAt: string;
  arrivedAt: string;
  workStartedAt: string;
};

/** What is already recorded for this technician on this job. */
async function loadProgress(job: VisitJob): Promise<ProgressRow | null> {
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
    id: text(row.id),
    tripStartedAt: text(row.trip_started_at),
    arrivedAt: text(row.arrived_at),
    workStartedAt: text(row.work_started_at),
  };
}

export type VisitStepResult = {
  error: string;
  notice?: string;
  state?: WorkflowState;
  /** The job was finished by this step, so its write-up is due. */
  finished?: boolean;
  partsUsed?: string[];
};

/**
 * Take a job to the next step of the visit: on the way, arrived, working,
 * review, completed, no show.
 *
 * `confirmed` is what was actually used from stock for each reserved line,
 * keyed by line id; a line it does not mention used what it asked for.
 */
export async function advanceVisit(
  job: VisitJob,
  input: {
    requested: string;
    source: "manual" | "geofence";
    confirmed?: Map<string, number | null>;
    /** How the customer is told the work is done, as chosen on Finish work. Absent: the automatic text. */
    completionNotice?: import("@/lib/work-complete-notice").CompletionNotice;
  },
): Promise<VisitStepResult> {
  const requested = input.requested;
  if (!isWorkflowState(requested)) return { error: "That is not a step a job can take." };

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
    patch.arrival_source = requested === "arrived" ? input.source : "manual";
  }

  if (requested === "working" && !progress?.workStartedAt) patch.work_started_at = now;
  if (requested === "completed") patch.completed_at = now;

  /*
   * Finishing a job claims it, then takes its parts off the count.
   *
   * Until now its parts were reserved: on the van, counted, but held for this
   * job. The status moves first, and only from the status this request read —
   * so of two taps that arrive together, one finishes the job and the other
   * finds it already finished, and the parts come off once. If taking them
   * then fails, the job goes back to where it was, still open with its parts
   * still reserved, rather than finished with them never taken.
   */
  let partsUsed: string[] = [];
  if (requested === "completed") {
    const { data: claimed, error: claimError } = await job.supabase
      .from("jobs")
      .update({ status: jobStatusFor(requested) })
      .eq("id", job.id)
      .eq("organization_id", job.organizationId)
      .eq("status", job.status)
      .select("id");

    if (claimError) return { error: "That could not be saved. Try again." };
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Somebody else finished it (or moved it) a moment ago.
      return { error: "", state: requested };
    }

    const parts = await takeReservedParts(job.supabase, {
      organizationId: job.organizationId,
      jobId: job.id,
      confirmed: input.confirmed ?? new Map(),
    });
    if (!parts.ok) {
      await job.supabase
        .from("jobs")
        .update({ status: job.status })
        .eq("id", job.id)
        .eq("organization_id", job.organizationId)
        .eq("status", jobStatusFor(requested));
      return { error: "The parts used could not be taken off the stock count, so the job is not completed yet. Try again." };
    }
    partsUsed = parts.said;
  } else {
    const { error: statusError } = await job.supabase
      .from("jobs")
      .update({ status: jobStatusFor(requested) })
      .eq("id", job.id)
      .eq("organization_id", job.organizationId);

    if (statusError) return { error: "That could not be saved. Try again." };
  }

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

  /*
   * Written down before anything is told to anybody.
   *
   * Every step of the visit is a line on the customer's history. `recordActivity`
   * passes only the job; the trigger on the table finds the customer from it.
   */
  await recordActivity(job.supabase, {
    organizationId: job.organizationId,
    eventType: `job.${requested}`,
    label: `Job ${requested.replace(/_/g, " ")}`,
    jobId: job.id,
    metadata: input.source === "geofence" ? { note: "recorded automatically" } : {},
  });

  if (requested === "completed") {
    // The business's "Work complete" message, if it sends one; consent, the
    // STOP ledger and quiet hours are decided where every automatic text is.
    let told = "";
    if (input.completionNotice) {
      const { sendWorkCompleteNotice } = await import("@/lib/work-complete-notice");
      told = await sendWorkCompleteNotice(job.id, input.completionNotice);
    } else {
      await sendJobEventMessage({ jobId: job.id, trigger: "job_completed" });
    }
    const said = [...partsUsed, told].filter(Boolean).join(" ");
    return {
      error: "",
      state: requested,
      finished: true,
      partsUsed,
      notice: said || undefined,
    };
  }

  // Setting off and turning up are the two moments the customer is waiting on,
  // so they are the two that are worth a text. Nothing else in the workflow
  // sends anything: starting work and finishing are the business's own
  // business, and a status tap that quietly texted somebody would be a surprise
  // nobody asked for.
  if (requested === "en_route" && patch.trip_started_at) {
    return { error: "", state: requested, notice: await tellCustomer(job, "en_route") };
  }

  if (recordsArrival) {
    return { error: "", state: requested, notice: await tellCustomer(job, "arrived") };
  }

  return { error: "", state: requested };
}

/** What each moment is called in the database, the templates, and to a person. */
const NOTICES = {
  en_route: {
    stamp: "customer_en_route_notified_at",
    trigger: "job_en_route",
    said: "Customer told you are on the way.",
  },
  arrived: {
    stamp: "customer_arrival_notified_at",
    trigger: "job_arrived",
    said: "Customer told you have arrived.",
  },
} as const;

/**
 * Tell the customer, at most once per job per moment.
 *
 * Once per job rather than once per technician: a second van setting off is not
 * a second journey from the customer's point of view, and somebody texted twice
 * about one visit is somebody who replies STOP. So the guard reads every row on
 * the job, not just this technician's. The same guard covers a technician who
 * steps out for a part and comes back — they have not arrived twice.
 *
 * Everything about whether this is allowed at all — consent, the STOP ledger,
 * quiet hours, and whether this business sends this particular message —
 * already lives in `sendJobEventMessage` and its template. Duplicating any of it
 * here would be a second set of rules to keep in step with the first, and the
 * one that goes stale is the one that texts somebody who opted out.
 */
async function tellCustomer(job: VisitJob, moment: keyof typeof NOTICES): Promise<string | undefined> {
  const notice = NOTICES[moment];

  const { data: alreadyTold } = await job.supabase
    .from("job_technician_progress")
    .select("id")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id)
    .not(notice.stamp, "is", null)
    .limit(1)
    .maybeSingle();

  if (alreadyTold) return undefined;

  const result = await sendJobEventMessage({ jobId: job.id, trigger: notice.trigger });

  // Nothing sent, nothing stamped. The column records when the customer was
  // told, so writing it after a refused send would turn "the template is
  // switched off" into "they were told" on every report that reads it.
  if (!result.sent) return undefined;

  const { data: mine } = await job.supabase
    .from("job_technician_progress")
    .select("id")
    .eq("organization_id", job.organizationId)
    .eq("job_id", job.id)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (mine) {
    // Widened deliberately: a computed key narrows to a string-indexed literal,
    // which the flexible client's excess-property guard reads as a row shape it
    // has never heard of.
    const stamp: Record<string, unknown> = { [notice.stamp]: new Date().toISOString() };

    await job.supabase
      .from("job_technician_progress")
      .update(stamp)
      .eq("id", text((mine as Record<string, unknown>).id))
      .eq("organization_id", job.organizationId);
  }

  return notice.said;
}
