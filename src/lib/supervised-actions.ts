/**
 * Phase 2: the rules for AI-proposed actions, free of imports so they can be
 * tested directly.
 *
 * The database is the authority (supabase/migrations/20261115000000_
 * supervised_actions.sql): it decides who may approve, binds approval to the
 * content fingerprint, and moves status. These functions mirror its policy so
 * the app can explain a refusal before asking, and classify what a provider
 * said so the executor never mistakes "unknown" for "failed".
 */

export const SUPERVISED_ACTIONS = [
  "send_text",
  "add_job_note",
  "send_customer_message",
  "send_customer_email",
  "create_internal_task",
  "send_contract",
  "send_estimate",
  "purchase_materials",
  "issue_refund",
  "change_price",
  "cancel_job",
] as const;

export type SupervisedAction = (typeof SUPERVISED_ACTIONS)[number];

export type ProposalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "revision_requested"
  | "superseded"
  | "expired"
  | "executing"
  | "executed"
  | "failed"
  | "uncertain";

export function isSupervisedAction(value: unknown): value is SupervisedAction {
  return typeof value === "string" && (SUPERVISED_ACTIONS as readonly string[]).includes(value);
}

/** Binding or financial: the owner, and only the owner, approves. */
const OWNER_ONLY = new Set<SupervisedAction>([
  "send_contract",
  "send_estimate",
  "purchase_materials",
  "issue_refund",
  "change_price",
  "cancel_job",
]);

const CUSTOMER_MESSAGES = new Set<SupervisedAction>(["send_text", "send_customer_message", "send_customer_email"]);

/**
 * Who may approve an action: "owner", "admin" (an owner or an admin), or null
 * for an action nobody may approve (unknown: fail closed). A customer message
 * from an approved template may be approved by an admin; one written for the
 * occasion needs the owner. Same as private.supervised_action_approver.
 */
export function approverFor(action: string, templateKey: string | null): "owner" | "admin" | null {
  if (!isSupervisedAction(action)) return null;
  if (OWNER_ONLY.has(action)) return "owner";
  if (CUSTOMER_MESSAGES.has(action)) return templateKey ? "admin" : "owner";
  return "admin";
}

export function mayApprove(role: string, action: string, templateKey: string | null): boolean {
  const needed = approverFor(action, templateKey);
  if (!needed) return false;
  return role === "owner" || (needed === "admin" && role === "admin");
}

/** Owner-only actions: binding documents and money. */
export function isOwnerOnly(action: string): boolean {
  return isSupervisedAction(action) && OWNER_ONLY.has(action);
}

export function isCustomerMessage(action: string): boolean {
  return isSupervisedAction(action) && CUSTOMER_MESSAGES.has(action);
}

/** Seconds before retry n (1-based): 30s, 2m, 8m, 32m, capped at an hour. Same as the database. */
export function retryDelaySeconds(attempt: number): number {
  const n = Math.max(0, Math.min(attempt, 10) - 1);
  return Math.min(3600, 30 * 4 ** n);
}

/**
 * What a provider's answer means for an action:
 *
 * - succeeded: it confirmed the action;
 * - failed: it refused, and doing it again would not help;
 * - retryable: it certainly did not happen, and may next time;
 * - uncertain: it may have happened. A timeout or dropped connection is not
 *   proof of failure, so nothing is sent again until someone checks.
 */
export type ExecutionOutcome = "succeeded" | "failed" | "retryable" | "uncertain";

/**
 * A provider error code (Twilio's numeric codes, Resend's names, an HTTP
 * status, or this app's own "network_error") classified.
 */
export function classifyProviderError(errorCode: string): Exclude<ExecutionOutcome, "succeeded"> {
  const code = errorCode.trim().toLowerCase();
  if (!code || code === "network_error" || code === "timeout") return "uncertain";
  // Rate limited: the provider said no before doing anything.
  if (code === "429" || code === "20429" || code === "rate_limit_exceeded") return "retryable";
  const status = Number(code);
  // A server error mid-request may or may not have done the work.
  if (Number.isInteger(status) && status >= 500 && status < 600) return "uncertain";
  if (code === "internal_server_error" || code === "application_error") return "uncertain";
  return "failed";
}

/**
 * The action types this deployment's executor may carry out, from
 * VOLTEIRA_PHASE2_EXECUTE (comma-separated). Empty unless set: nothing runs.
 * Unknown names are dropped, never guessed at.
 */
export function enabledActionTypes(setting: string | undefined): SupervisedAction[] {
  if (!setting) return [];
  const wanted = setting.split(",").map((part) => part.trim()).filter(Boolean);
  return SUPERVISED_ACTIONS.filter((action) => wanted.includes(action));
}

/**
 * Whether an approved invoice reminder is still true right before it goes
 * out. The approval was for a reminder about this balance on this due date;
 * a payment, a void or a changed due date since then means the wording no
 * longer holds, so it is not sent (a new proposal is needed). Null when it
 * may go, else the reason it may not.
 */
export function invoiceReminderRefusal(
  approved: { balanceCents: number | null; dueAt: string | null },
  current: { status: string; balanceDueCents: number; dueAt: string | null } | null,
): string | null {
  if (!current) return "The invoice is no longer on file. Nothing was sent.";
  const status = current.status.trim().toLowerCase();
  if (status === "paid" || status === "void" || status === "draft") {
    return `The invoice is ${status === "void" ? "void" : status === "draft" ? "back in draft" : "paid"} now. Nothing was sent.`;
  }
  if (current.balanceDueCents <= 0) return "The invoice has been paid. Nothing was sent.";
  if (approved.balanceCents === null || current.balanceDueCents !== approved.balanceCents) {
    return "The balance changed after this was approved. Nothing was sent; a new reminder can be proposed.";
  }
  if (approved.dueAt && (current.dueAt ?? "").slice(0, 10) !== approved.dueAt.slice(0, 10)) {
    return "The due date changed after this was approved. Nothing was sent.";
  }
  return null;
}

/** What a decision's result code means, said to the person who tried. */
export function decisionMessage(code: string): string {
  switch (code) {
    case "ok":
      return "Saved.";
    case "not_found":
      return "That proposal could not be found.";
    case "forbidden":
      return "Your role can't approve this kind of action. The business owner can.";
    case "self_approval":
      return "You proposed this yourself, so someone else has to approve it.";
    case "already_decided":
      return "Someone has already decided this proposal.";
    case "content_changed":
      return "This proposal is not the one you were shown. Reload and review it again.";
    case "expired":
      return "This proposal ran out before it was approved. Ask for a new one.";
    case "unauthenticated":
      return "Sign in again to decide.";
    case "not_uncertain":
      return "Only an action whose outcome is unknown can be settled this way.";
    case "restricted_channel":
      return "Binding and financial actions are approved in Volteira itself, not from ChatGPT.";
    default:
      return "The decision could not be saved. Try again.";
  }
}

/** Plain words for a status, for the inbox and ChatGPT. */
export function statusLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Waiting for approval";
    case "approved":
      return "Approved, waiting to run";
    case "executing":
      return "Running";
    case "executed":
      return "Done";
    case "failed":
      return "Failed";
    case "uncertain":
      return "Outcome unknown, needs checking";
    case "rejected":
      return "Rejected";
    case "expired":
      return "Expired";
    case "superseded":
      return "Replaced";
    case "revision_requested":
      return "Changes requested";
    default:
      return status;
  }
}

/** The inbox's views and the statuses each shows. */
export const PROPOSAL_VIEWS = {
  pending: ["pending"],
  approved: ["approved"],
  running: ["executing"],
  attention: ["uncertain", "failed"],
  done: ["executed"],
  closed: ["rejected", "expired", "superseded", "revision_requested"],
} as const satisfies Record<string, readonly ProposalStatus[]>;

export type ProposalView = keyof typeof PROPOSAL_VIEWS;

export function proposalView(value: unknown): ProposalView {
  return typeof value === "string" && value in PROPOSAL_VIEWS ? (value as ProposalView) : "pending";
}
