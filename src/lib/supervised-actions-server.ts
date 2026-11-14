import "server-only";

import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { PROPOSAL_VIEWS, isSupervisedAction, type ProposalView, type SupervisedAction } from "@/lib/supervised-actions";

/**
 * Reading and deciding supervised actions. Every read is scoped to the
 * business the server verified (the session, or the ChatGPT connection);
 * every write goes through the database functions in
 * 20261115000000_supervised_actions.sql, which check again.
 */

type Row = Record<string, unknown>;

const text = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (value === null || value === undefined || value === "" ? null : Number(value));

export type SupervisedProposal = {
  id: string;
  actionType: string;
  status: string;
  content: string;
  reason: string;
  contentHash: string;
  templateKey: string | null;
  jobId: string | null;
  jobNumber: string | null;
  customerId: string | null;
  customerName: string;
  recipient: string;
  amountCents: number | null;
  documentRef: string;
  documentVersion: string;
  payload: Record<string, unknown>;
  source: string;
  proposedByKind: string;
  preAuthorized: boolean;
  createdAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedVia: string;
  decidedAt: string;
  decisionNote: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  executedAt: string;
  externalRef: string;
  error: string;
};

export type AuditEntry = {
  id: number;
  event: string;
  fromStatus: string;
  toStatus: string;
  actorId: string | null;
  actorKind: string;
  via: string;
  attempt: number | null;
  detail: Record<string, unknown>;
  createdAt: string;
};

const COLUMNS =
  "id, action_type, status, content, reason, content_hash, template_key, job_id, customer_id, recipient, amount_cents, document_ref, document_version, payload, source, proposed_by_kind, pre_authorized, created_at, expires_at, decided_by, decided_via, decided_at, decision_note, attempts, max_attempts, next_attempt_at, executed_at, external_ref, error, jobs ( job_number ), customers ( first_name, last_name, company_name )";

function customerName(row: Row): string {
  const customer = (row.customers ?? null) as Row | null;
  if (!customer) return "";
  return [text(customer.first_name), text(customer.last_name)].filter(Boolean).join(" ") || text(customer.company_name);
}

function toProposal(row: Row): SupervisedProposal {
  const job = (row.jobs ?? null) as Row | null;
  return {
    id: text(row.id),
    actionType: text(row.action_type),
    status: text(row.status),
    content: text(row.content),
    reason: text(row.reason),
    contentHash: text(row.content_hash),
    templateKey: text(row.template_key) || null,
    jobId: text(row.job_id) || null,
    jobNumber: job?.job_number !== undefined && job?.job_number !== null ? String(job.job_number) : null,
    customerId: text(row.customer_id) || null,
    customerName: customerName(row),
    recipient: text(row.recipient),
    amountCents: num(row.amount_cents),
    documentRef: text(row.document_ref),
    documentVersion: text(row.document_version),
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    source: text(row.source),
    proposedByKind: text(row.proposed_by_kind),
    preAuthorized: row.pre_authorized === true,
    createdAt: text(row.created_at),
    expiresAt: text(row.expires_at),
    decidedBy: text(row.decided_by) || null,
    decidedVia: text(row.decided_via),
    decidedAt: text(row.decided_at),
    decisionNote: text(row.decision_note),
    attempts: Number(row.attempts ?? 0),
    maxAttempts: Number(row.max_attempts ?? 0),
    nextAttemptAt: text(row.next_attempt_at),
    executedAt: text(row.executed_at),
    externalRef: text(row.external_ref),
    error: text(row.error),
  };
}

/** Proposals in one view of the inbox, newest first, and how many each view holds. */
export async function listSupervisedProposals(
  db: FlexibleSupabaseClient,
  organizationId: string,
  view: ProposalView,
  limit = 50,
): Promise<{ ok: true; proposals: SupervisedProposal[]; counts: Record<ProposalView, number> } | { ok: false }> {
  const statuses = [...PROPOSAL_VIEWS[view]];
  const [{ data, error }, { data: all, error: countError }] = await Promise.all([
    db
      .from("task_proposals")
      .select(COLUMNS)
      .eq("organization_id", organizationId)
      .in("status", statuses)
      .order("created_at", { ascending: false })
      .limit(limit),
    db.from("task_proposals").select("status").eq("organization_id", organizationId).limit(2000),
  ]);
  if (error || countError) return { ok: false };
  const counts = Object.fromEntries(Object.keys(PROPOSAL_VIEWS).map((key) => [key, 0])) as Record<ProposalView, number>;
  for (const row of (all ?? []) as Row[]) {
    for (const [key, list] of Object.entries(PROPOSAL_VIEWS) as [ProposalView, readonly string[]][]) {
      if (list.includes(text(row.status))) counts[key] += 1;
    }
  }
  return { ok: true, proposals: ((data ?? []) as Row[]).map(toProposal), counts };
}

/** One proposal with its audit trail, or null when it isn't this business's. */
export async function getSupervisedProposal(
  db: FlexibleSupabaseClient,
  organizationId: string,
  id: string,
): Promise<{ proposal: SupervisedProposal; audit: AuditEntry[] } | null> {
  if (!UUID.test(id)) return null;
  const { data } = await db.from("task_proposals").select(COLUMNS).eq("organization_id", organizationId).eq("id", id).maybeSingle();
  if (!data) return null;
  const { data: audit } = await db
    .from("supervised_action_audit")
    .select("id, event, from_status, to_status, actor_id, actor_kind, via, attempt, detail, created_at")
    .eq("organization_id", organizationId)
    .eq("proposal_id", id)
    .order("id", { ascending: true })
    .limit(200);
  return {
    proposal: toProposal(data as Row),
    audit: ((audit ?? []) as Row[]).map((row) => ({
      id: Number(row.id),
      event: text(row.event),
      fromStatus: text(row.from_status),
      toStatus: text(row.to_status),
      actorId: text(row.actor_id) || null,
      actorKind: text(row.actor_kind),
      via: text(row.via),
      attempt: num(row.attempt),
      detail: (row.detail && typeof row.detail === "object" ? row.detail : {}) as Record<string, unknown>,
      createdAt: text(row.created_at),
    })),
  };
}

/** The audit trails for several proposals at once, for the inbox. */
export async function auditFor(
  db: FlexibleSupabaseClient,
  organizationId: string,
  ids: string[],
): Promise<Map<string, AuditEntry[]>> {
  const trails = new Map<string, AuditEntry[]>();
  if (ids.length === 0) return trails;
  const { data } = await db
    .from("supervised_action_audit")
    .select("id, proposal_id, event, from_status, to_status, actor_id, actor_kind, via, attempt, detail, created_at")
    .eq("organization_id", organizationId)
    .in("proposal_id", ids)
    .order("id", { ascending: true })
    .limit(1000);
  for (const row of (data ?? []) as Row[]) {
    const id = text(row.proposal_id);
    const list = trails.get(id) ?? [];
    list.push({
      id: Number(row.id),
      event: text(row.event),
      fromStatus: text(row.from_status),
      toStatus: text(row.to_status),
      actorId: text(row.actor_id) || null,
      actorKind: text(row.actor_kind),
      via: text(row.via),
      attempt: num(row.attempt),
      detail: (row.detail && typeof row.detail === "object" ? row.detail : {}) as Record<string, unknown>,
      createdAt: text(row.created_at),
    });
    trails.set(id, list);
  }
  return trails;
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type DecisionResult = { ok: boolean; code: string; status: string | null };

function decisionFrom(data: unknown, error: { message?: string } | null): DecisionResult {
  if (error) {
    console.error("supervised decision failed", { message: error.message });
    return { ok: false, code: "error", status: null };
  }
  const row = (Array.isArray(data) ? data[0] : data) as Row | null;
  return { ok: row?.ok === true, code: text(row?.code) || "error", status: text(row?.status) || null };
}

/**
 * The signed-in person decides, with their own client: the database reads who
 * they are from their session (auth.uid()).
 */
export async function decideAsSignedInUser(
  userDb: FlexibleSupabaseClient,
  input: { proposalId: string; decision: "approve" | "reject"; contentHash: string; note?: string },
): Promise<DecisionResult> {
  const { data, error } = await userDb.rpc("decide_supervised_proposal", {
    p_proposal_id: input.proposalId,
    p_decision: input.decision,
    p_content_hash: input.contentHash,
    p_note: input.note ?? null,
  });
  return decisionFrom(data, error);
}

/**
 * The server decides for a person it verified itself: the owner a ChatGPT
 * connection was made by, re-checked on every call. Never a person named by
 * the model.
 */
export async function decideForVerifiedActor(input: {
  actorUserId: string;
  via: "chatgpt" | "app";
  proposalId: string;
  decision: "approve" | "reject";
  contentHash: string;
  note?: string;
}): Promise<DecisionResult> {
  if (!input.actorUserId) return { ok: false, code: "unauthenticated", status: null };
  const { data, error } = await asFlexibleClient(getSupabaseAdmin()).rpc("decide_supervised_proposal_for", {
    p_actor: input.actorUserId,
    p_via: input.via,
    p_proposal_id: input.proposalId,
    p_decision: input.decision,
    p_content_hash: input.contentHash,
    p_note: input.note ?? null,
  });
  return decisionFrom(data, error);
}

export async function reconcileAsSignedInUser(
  userDb: FlexibleSupabaseClient,
  input: { proposalId: string; outcome: "executed" | "failed"; note?: string },
): Promise<DecisionResult> {
  const { data, error } = await userDb.rpc("reconcile_supervised_action", {
    p_proposal_id: input.proposalId,
    p_outcome: input.outcome,
    p_note: input.note ?? null,
  });
  return decisionFrom(data, error);
}

export type NewProposal = {
  organizationId: string;
  actionType: SupervisedAction;
  content: string;
  reason: string;
  source: "event" | "chatgpt" | "app";
  proposedBy: string | null;
  proposedByKind: "ai" | "system" | "person";
  /** Hours until it can no longer be approved (1 to 720). */
  expiresInHours: number;
  jobId?: string | null;
  customerId?: string | null;
  recipient?: string | null;
  amountCents?: number | null;
  documentRef?: string | null;
  documentVersion?: string | null;
  templateKey?: string | null;
  payload?: Record<string, unknown>;
  idempotencyKey?: string | null;
  dedupeKey?: string | null;
  eventId?: string | null;
};

export type CreatedProposal =
  | { ok: true; id: string; contentHash: string; status: string; created: boolean }
  | { ok: false; message: string };

/** Records a proposal. A repeat of the same idempotency or dedupe key returns the first. */
export async function createSupervisedProposal(input: NewProposal): Promise<CreatedProposal> {
  if (!isSupervisedAction(input.actionType)) return { ok: false, message: "Unknown action type." };
  const hours = Math.min(720, Math.max(1, Math.round(input.expiresInHours)));
  const { data, error } = await asFlexibleClient(getSupabaseAdmin()).rpc("create_supervised_proposal", {
    p_organization_id: input.organizationId,
    p_action_type: input.actionType,
    p_content: input.content.slice(0, 5000),
    p_reason: input.reason ? input.reason.slice(0, 1000) : null,
    p_source: input.source,
    p_proposed_by: input.proposedBy,
    p_proposed_by_kind: input.proposedByKind,
    p_expires_at: new Date(Date.now() + hours * 3_600_000).toISOString(),
    p_job_id: input.jobId ?? null,
    p_customer_id: input.customerId ?? null,
    p_recipient: input.recipient ?? null,
    p_amount_cents: input.amountCents ?? null,
    p_document_ref: input.documentRef ?? null,
    p_document_version: input.documentVersion ?? null,
    p_template_key: input.templateKey ?? null,
    p_payload: input.payload ?? {},
    p_target: {},
    p_idempotency_key: input.idempotencyKey ?? null,
    p_dedupe_key: input.dedupeKey ?? null,
    p_event_id: input.eventId ?? null,
  });
  if (error) {
    console.error("create supervised proposal failed", { code: error.code });
    if (error.code === "42501" || error.code === "22023") return { ok: false, message: error.message };
    return { ok: false, message: "The proposal could not be saved." };
  }
  const row = (Array.isArray(data) ? data[0] : data) as Row | null;
  if (!row?.proposal_id) return { ok: false, message: "The proposal could not be saved." };
  return {
    ok: true,
    id: text(row.proposal_id),
    contentHash: text(row.content_hash),
    status: text(row.status),
    created: row.created === true,
  };
}
