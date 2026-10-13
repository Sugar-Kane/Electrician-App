/**
 * Support cases: the words, the lifecycle, and where each linked record lives.
 *
 * The database enforces the lifecycle (`admin_case_move`); these are here so
 * the page offers only the moves that will work and says up front what each
 * one needs.
 *
 * Import-free.
 */

export const CASE_CATEGORIES = [
  { value: "booking", label: "Booking" },
  { value: "texting", label: "Texting" },
  { value: "email", label: "Email" },
  { value: "payment", label: "Payment" },
  { value: "assistant", label: "Phone assistant" },
  { value: "schedule", label: "Schedule" },
  { value: "access", label: "Signing in or access" },
  { value: "data", label: "Missing or wrong data" },
  { value: "other", label: "Something else" },
] as const;

export const CASE_SEVERITIES = [
  { value: "urgent", label: "Urgent: work or money is stopped" },
  { value: "high", label: "High: hurting them today" },
  { value: "normal", label: "Normal" },
  { value: "low", label: "Low: a nuisance" },
] as const;

/** The console pill tone for each severity. */
export const CASE_SEVERITY_TONE: Record<string, "problem" | "waiting" | "neutral"> = {
  urgent: "problem",
  high: "problem",
  normal: "waiting",
  low: "neutral",
};

export const CASE_STATES: Record<string, string> = {
  open: "Open",
  waiting: "Waiting on someone",
  verifying: "Fix ready to verify",
  closed: "Closed",
};

export type CaseFacts = { state: string; fix: string; resolutionEvidence: string };

export type CaseMove = { to: string; label: string; needs: string | null };

/** The moves a case can make from where it is, and what stands in the way of each. */
export function caseMoves(facts: CaseFacts): CaseMove[] {
  const needsFix = facts.fix ? null : "Write down the fix first.";
  const needsEvidence = facts.resolutionEvidence ? null : "Write down the evidence that it's fixed first.";
  switch (facts.state) {
    case "open":
      return [
        { to: "waiting", label: "Waiting on someone", needs: null },
        { to: "verifying", label: "Fix ready to verify", needs: needsFix },
        { to: "closed", label: "Close", needs: needsEvidence },
      ];
    case "waiting":
      return [
        { to: "open", label: "Back to open", needs: null },
        { to: "verifying", label: "Fix ready to verify", needs: needsFix },
        { to: "closed", label: "Close", needs: needsEvidence },
      ];
    case "verifying":
      return [
        { to: "closed", label: "Verified: close", needs: needsEvidence },
        { to: "open", label: "Not fixed: back to open", needs: null },
      ];
    case "closed":
      return [{ to: "open", label: "Reopen", needs: null }];
    default:
      return [];
  }
}

export type CaseTarget = {
  type: string;
  id: string;
  label: string;
  /** For a job, its number, which is how the console addresses it. */
  jobNumber?: string;
};

/** Where a linked record opens in the console. */
export function caseTargetHref(organizationId: string, target: CaseTarget): string {
  const base = `/admin/organizations/${organizationId}`;
  switch (target.type) {
    case "message":
      return `${base}/messages/${target.id}`;
    case "booking":
      return `${base}?tab=bookings#booking-${target.id}`;
    case "job":
      return target.jobNumber ? `${base}/jobs/${target.jobNumber}` : `${base}?tab=jobs`;
    case "customer":
      return `${base}?tab=jobs&customer=${target.id}`;
    case "payment":
      return `${base}?tab=money`;
    case "assistant":
      return `${base}?tab=assistant`;
    case "operation":
      return `/admin/recovery?business=${organizationId}`;
    default:
      return base;
  }
}

const TARGET_CATEGORY: Record<string, string> = {
  message: "texting",
  booking: "booking",
  job: "schedule",
  payment: "payment",
  assistant: "assistant",
};

/** The link that opens a new case about a record, with the business and the record filled in. */
export function openCaseHref(input: { organizationId: string; type?: string; id?: string; label?: string; category?: string }): string {
  const query = new URLSearchParams({ org: input.organizationId });
  if (input.type && input.id) {
    query.set("type", input.type);
    query.set("id", input.id);
  }
  if (input.label) query.set("label", input.label.slice(0, 120));
  const category = input.category ?? (input.type ? TARGET_CATEGORY[input.type] : undefined);
  if (category) query.set("category", category);
  return `/admin/cases/new?${query.toString()}`;
}
