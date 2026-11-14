/**
 * Phase 2 security boundary for AI-suggested business actions.
 * This module is intentionally pure: no AI response or MCP caller can grant
 * itself execution privileges by changing a label or approval flag.
 */
export const SUPERVISED_ACTIONS = {
  send_contract: "contract",
  send_estimate: "estimate",
  purchase_materials: "purchase",
  issue_refund: "refund",
  change_price: "pricing",
  cancel_job: "cancellation",
  send_customer_message: "communication",
  create_internal_task: "internal",
} as const;

export type SupervisedAction = keyof typeof SUPERVISED_ACTIONS;
export type ApprovalState = "proposed" | "approved" | "rejected" | "expired" | "executing" | "completed" | "failed";
export type Decision = { actorId: string; role: string; at: string; actionDigest: string };
export type ActionProposal = {
  id: string;
  organizationId: string;
  createdBy: string;
  action: SupervisedAction;
  payloadDigest: string;
  state: ApprovalState;
  expiresAt: string;
  approvedBy?: string | null;
  approvedAt?: string | null;
  executionId?: string | null;
};

const FINANCIAL_OR_BINDING = new Set<SupervisedAction>([
  "send_contract", "send_estimate", "purchase_materials", "issue_refund", "change_price", "cancel_job",
]);

export function requiresHumanApproval(action: SupervisedAction): boolean {
  return action !== "create_internal_task";
}

export function mayApprove(role: string, action: SupervisedAction): boolean {
  if (role === "owner") return true;
  return role === "admin" && !FINANCIAL_OR_BINDING.has(action);
}

/**
 * Execution must be checked again by the server using a fresh DB record.
 * An approval is bound to exact immutable action arguments by digest.
 * Database transaction and unique execution key are still required.
 */
export function mayBeginExecution(
  proposal: ActionProposal,
  organizationId: string,
  actionDigest: string,
  now: Date,
): boolean {
  return proposal.organizationId === organizationId
    && proposal.state === "approved"
    && proposal.payloadDigest === actionDigest
    && proposal.approvedBy !== null
    && typeof proposal.approvedBy === "string"
    && proposal.approvedBy.length > 0
    && !proposal.executionId
    && Number.isFinite(Date.parse(proposal.expiresAt))
    && Date.parse(proposal.expiresAt) > now.getTime();
}

export function mayDecide(
  proposal: ActionProposal,
  decision: Decision,
  organizationId: string,
  now: Date,
): boolean {
  return proposal.organizationId === organizationId
    && proposal.state === "proposed"
    && proposal.payloadDigest === decision.actionDigest
    && proposal.createdBy !== decision.actorId
    && mayApprove(decision.role, proposal.action)
    && Number.isFinite(Date.parse(proposal.expiresAt))
    && Date.parse(proposal.expiresAt) > now.getTime();
}
