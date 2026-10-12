/**
 * Where a job stands, in the words the jobs list filters by.
 *
 * Nothing new is stored: the stage is read off what the job already has — its
 * status, whether it has a time, and whether its agreement has been sent or
 * signed. So a job can join at any point. A diagnostic is never "waiting for
 * an estimate", and work the customer already agreed to skips straight to
 * scheduling.
 *
 * Import-free, so the jobs page and anything else can share one reading.
 */

export type JobStage =
  | "needs_estimate"
  | "awaiting_approval"
  | "to_schedule"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "canceled";

export const JOB_STAGE_LABELS: Record<JobStage, string> = {
  needs_estimate: "Needs estimate",
  awaiting_approval: "Awaiting approval",
  to_schedule: "To schedule",
  scheduled: "Scheduled",
  in_progress: "In progress",
  completed: "Completed",
  canceled: "Canceled",
};

/** The filters, in the order the work moves through them. */
export const JOB_STAGE_FILTERS: { value: JobStage | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "needs_estimate", label: JOB_STAGE_LABELS.needs_estimate },
  { value: "awaiting_approval", label: JOB_STAGE_LABELS.awaiting_approval },
  { value: "to_schedule", label: JOB_STAGE_LABELS.to_schedule },
  { value: "scheduled", label: JOB_STAGE_LABELS.scheduled },
  { value: "in_progress", label: JOB_STAGE_LABELS.in_progress },
  { value: "completed", label: JOB_STAGE_LABELS.completed },
];

export function isJobStageFilter(value: string): value is JobStage | "all" {
  return JOB_STAGE_FILTERS.some((filter) => filter.value === value);
}

/** The newest agreement on the job that was not voided, as far as approval goes. */
export type AgreementState = {
  sent: boolean;
  signed: boolean;
  /** The price the agreement states, when it saved one. */
  totalCents?: number | null;
};

export function jobStage(job: {
  /** The reading label from mapJob: "Scheduled", "In progress", "Completed"... */
  status: string;
  /** Whether the job has a start time. */
  scheduled: boolean;
  kindOfWork: string;
  agreement?: AgreementState | null;
}): JobStage {
  if (job.status === "Canceled") return "canceled";
  if (job.status === "Completed") return "completed";
  if (job.status === "In progress") return "in_progress";

  if (job.agreement?.signed) return job.scheduled ? "scheduled" : "to_schedule";
  if (job.agreement?.sent) return "awaiting_approval";

  if (job.scheduled) return "scheduled";
  // A diagnostic is priced already — it is the fee — so the next thing it
  // needs is a time, not an estimate.
  if (job.kindOfWork === "Diagnostic") return "to_schedule";
  return "needs_estimate";
}

/** Whether a visit's start time has already gone by. */
export function startTimePassed(startsAt: string | undefined): boolean {
  if (!startsAt) return false;
  const at = Date.parse(startsAt);
  return Number.isFinite(at) && at < Date.now();
}
