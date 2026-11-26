import "server-only";

import { sendCustomerText } from "@/lib/customer-text";
import { sendEmail } from "@/lib/email";
import { evaluateQuietHours } from "@/lib/messaging-rules";
import { toE164 } from "@/lib/phone-format";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient, type FlexibleSupabaseClient } from "@/lib/supabase/flexible";
import { classifyProviderError, enabledActionTypes, invoiceReminderRefusal, type SupervisedAction } from "@/lib/supervised-actions";
import { sendSms } from "@/lib/twilio";

/**
 * Carries out approved actions, once.
 *
 * The database hands out work (claim_supervised_actions: SKIP LOCKED, a
 * lease and a claim token) and takes the outcome only from the worker holding
 * the current claim (finish_supervised_action). A worker that dies leaves the
 * action "uncertain" for the owner to check; nothing is resent blindly. A
 * provider timeout is reported as uncertain, never as failed.
 *
 * Only action types listed in VOLTEIRA_PHASE2_EXECUTE run, and only those
 * with a handler here. Contracts, estimates, purchases, refunds, price
 * changes and cancellations have none on purpose: their approval is recorded
 * and the owner carries them out in Volteira, then marks them done.
 */

type Row = Record<string, unknown>;
const text = (value: unknown) => (typeof value === "string" ? value : "");

export type HandlerResult = {
  outcome: "succeeded" | "failed" | "retryable" | "deferred" | "uncertain";
  externalRef?: string;
  receipt?: Record<string, unknown>;
  error?: string;
  retryAt?: string;
};

export type ClaimedAction = {
  id: string;
  organizationId: string;
  actionType: SupervisedAction;
  content: string;
  claimToken: string;
  attempts: number;
  jobId: string | null;
  customerId: string | null;
  recipient: string;
  amountCents: number | null;
  templateKey: string | null;
  payload: Record<string, unknown>;
  idempotencyKey: string;
};

export type ExecutorDeps = {
  db: FlexibleSupabaseClient;
  sendSms: typeof sendSms;
  sendEmail: typeof sendEmail;
  now: () => Date;
};

type Handler = (action: ClaimedAction, deps: ExecutorDeps) => Promise<HandlerResult>;

/** Not now: quiet hours. Tried again in 15 minutes without using an attempt. */
async function quietHoursDeferral(action: ClaimedAction, deps: ExecutorDeps): Promise<HandlerResult | null> {
  const [{ data: settings }, { data: organization }] = await Promise.all([
    deps.db.from("messaging_settings").select("quiet_hours_start, quiet_hours_end").eq("organization_id", action.organizationId).maybeSingle(),
    deps.db.from("organizations").select("timezone").eq("id", action.organizationId).maybeSingle(),
  ]);
  const quiet = evaluateQuietHours(
    text(settings?.quiet_hours_start) || "21:00:00",
    text(settings?.quiet_hours_end) || "08:00:00",
    text(organization?.timezone) || "America/Los_Angeles",
    deps.now(),
  );
  if (!quiet.currentlyQuiet) return null;
  return {
    outcome: "deferred",
    error: `Quiet hours until ${quiet.end.slice(0, 5)}.`,
    retryAt: new Date(deps.now().getTime() + 15 * 60_000).toISOString(),
  };
}

const sendText: Handler = async (action, deps) => {
  if (!action.customerId) return { outcome: "failed", error: "No customer to text." };
  const { data: customer } = await deps.db
    .from("customers")
    .select("id, phone")
    .eq("organization_id", action.organizationId)
    .eq("id", action.customerId)
    .maybeSingle();
  if (!customer) return { outcome: "failed", error: "The customer is no longer on file." };
  // The number the owner approved, and only that number.
  const approved = toE164(action.recipient);
  const current = toE164(text(customer.phone));
  if (!approved) return { outcome: "failed", error: "No number was approved for this text." };
  if (approved !== current) return { outcome: "failed", error: "The customer's number changed after this was approved. Nothing was sent." };

  // A reminder about an invoice must still be true: not paid, voided or
  // changed since it was approved (it may have waited, or been deferred).
  const invoiceId = text(action.payload.invoice_id);
  if (invoiceId) {
    const { data: invoice } = await deps.db
      .from("invoices")
      .select("id, status, balance_due_cents, due_at")
      .eq("organization_id", action.organizationId)
      .eq("id", invoiceId)
      .maybeSingle();
    const refusal = invoiceReminderRefusal(
      { balanceCents: action.amountCents, dueAt: text(action.payload.due_at) || null },
      invoice
        ? { status: text(invoice.status), balanceDueCents: Number(invoice.balance_due_cents ?? 0), dueAt: text(invoice.due_at) || null }
        : null,
    );
    if (refusal) return { outcome: "failed", error: refusal };
  }

  const deferral = await quietHoursDeferral(action, deps);
  if (deferral) return deferral;

  // Consent (and a STOP) is checked inside, right before sending.
  const sent = await sendCustomerText(deps.db, {
    organizationId: action.organizationId,
    customerId: action.customerId,
    body: action.content,
    send: deps.sendSms,
    to: approved,
    pauseAssistant: false,
  });
  if (sent.ok) {
    return { outcome: "succeeded", externalRef: sent.providerMessageId, receipt: { messageId: sent.messageId, provider: "twilio" } };
  }
  if (sent.code === "SEND_FAILED") {
    return { outcome: classifyProviderError(sent.errorCode), error: sent.message, receipt: { messageId: sent.messageId, errorCode: sent.errorCode } };
  }
  // Saving the message failed before anything left: safe to try again.
  if (sent.code === "NOT_SAVED") return { outcome: "retryable", error: sent.message };
  return { outcome: "failed", error: sent.message };
};

const sendCustomerEmail: Handler = async (action, deps) => {
  if (!action.customerId) return { outcome: "failed", error: "No customer to email." };
  const { data: customer } = await deps.db
    .from("customers")
    .select("id, email")
    .eq("organization_id", action.organizationId)
    .eq("id", action.customerId)
    .maybeSingle();
  if (!customer) return { outcome: "failed", error: "The customer is no longer on file." };
  const approved = action.recipient.trim().toLowerCase();
  if (!approved || approved !== text(customer.email).trim().toLowerCase()) {
    return { outcome: "failed", error: "The customer's email changed after this was approved. Nothing was sent." };
  }
  const { data: optOut } = await deps.db
    .from("messaging_consent")
    .select("opted_out_at")
    .eq("organization_id", action.organizationId)
    .eq("customer_id", action.customerId)
    .eq("channel", "email")
    .not("opted_out_at", "is", null)
    .limit(1)
    .maybeSingle();
  if (optOut) return { outcome: "failed", error: "The customer opted out of email." };

  const subject = text(action.payload.subject).slice(0, 150) || "A message from your electrician";
  const escaped = action.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const sent = await deps.sendEmail({
    to: approved,
    subject,
    text: action.content,
    html: `<p>${escaped.replace(/\n/g, "<br>")}</p>`,
    organizationId: action.organizationId,
    contactButtons: true,
    idempotencyKey: action.idempotencyKey,
  });
  if (sent.ok) return { outcome: "succeeded", externalRef: sent.id, receipt: { provider: "resend" } };
  return { outcome: classifyProviderError(sent.errorCode), error: sent.errorDetail, receipt: { errorCode: sent.errorCode } };
};

/** A note in the job's (or customer's) history. Written once per proposal. */
const writeNote: Handler = async (action, deps) => {
  if (!action.jobId && !action.customerId) return { outcome: "failed", error: "Nothing to attach the note to." };
  const { data: existing } = await deps.db
    .from("activity_events")
    .select("id")
    .eq("organization_id", action.organizationId)
    .eq("metadata->>supervised_proposal_id", action.id)
    .limit(1)
    .maybeSingle();
  if (existing) return { outcome: "succeeded", externalRef: text(existing.id) };
  const { data, error } = await deps.db
    .from("activity_events")
    .insert({
      organization_id: action.organizationId,
      event_type: action.actionType === "create_internal_task" ? "automation.follow_up" : "automation.note",
      label: action.content.slice(0, 500),
      job_id: action.jobId,
      customer_id: action.customerId,
      entity_type: action.jobId ? "job" : "customer",
      entity_id: action.jobId ?? action.customerId,
      metadata: { supervised_proposal_id: action.id, template: action.templateKey },
    })
    .select("id")
    .single();
  // A database write that failed did not happen.
  if (error || !data) return { outcome: "retryable", error: "The note could not be saved." };
  return { outcome: "succeeded", externalRef: text(data.id) };
};

/**
 * An approved ChatGPT request: the original tool call runs now, through the
 * same code ChatGPT would have reached, after the connection is checked again.
 * The tool's own checks (paid invoice, STOP, contract status) run again too.
 */
const runChatGptTool: Handler = async (action) => {
  const tool = text(action.payload.tool);
  const credentialId = text(action.payload.credential_id);
  const args = action.payload.args && typeof action.payload.args === "object" && !Array.isArray(action.payload.args)
    ? (action.payload.args as Record<string, unknown>)
    : {};
  if (!tool || !credentialId) return { outcome: "failed", error: "This request is missing its tool or connection. Nothing was sent." };
  const { runApprovedChatGptCall } = await import("@/lib/mcp-dispatch");
  const run = await runApprovedChatGptCall({ organizationId: action.organizationId, credentialId, tool, args });
  return run.ok
    ? { outcome: "succeeded", receipt: { tool, result: run.text } }
    : { outcome: "failed", error: run.error };
};

export const HANDLERS: Partial<Record<SupervisedAction, Handler>> = {
  chatgpt_tool: runChatGptTool,
  send_text: sendText,
  send_customer_message: sendText,
  send_customer_email: sendCustomerEmail,
  add_job_note: writeNote,
  create_internal_task: writeNote,
};

/** Action types this deployment runs: named in the setting and handled here. */
export function runnableActionTypes(setting: string | undefined): SupervisedAction[] {
  return enabledActionTypes(setting).filter((action) => Boolean(HANDLERS[action]));
}

function toClaimed(row: Row): ClaimedAction {
  return {
    id: text(row.id),
    organizationId: text(row.organization_id),
    actionType: text(row.action_type) as SupervisedAction,
    content: text(row.content),
    claimToken: text(row.claim_token),
    attempts: Number(row.attempts ?? 0),
    jobId: text(row.job_id) || null,
    customerId: text(row.customer_id) || null,
    recipient: text(row.recipient),
    amountCents: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents),
    templateKey: text(row.template_key) || null,
    payload: (row.payload && typeof row.payload === "object" ? row.payload : {}) as Record<string, unknown>,
    idempotencyKey: text(row.idempotency_key),
  };
}

export type WorkerReport = { claimed: number; results: { id: string; outcome: string; status: string }[] };

/**
 * One pass: claim what is due, run each, record each outcome. Returns what
 * happened. `only` limits the pass to one proposal (run right after approval).
 */
export async function runSupervisedWorker(options: { only?: string; limit?: number; deps?: Partial<ExecutorDeps> } = {}): Promise<WorkerReport> {
  const deps: ExecutorDeps = {
    db: options.deps?.db ?? asFlexibleClient(getSupabaseAdmin()),
    sendSms: options.deps?.sendSms ?? sendSms,
    sendEmail: options.deps?.sendEmail ?? sendEmail,
    now: options.deps?.now ?? (() => new Date()),
  };
  const types = runnableActionTypes(process.env.VOLTEIRA_PHASE2_EXECUTE);
  if (types.length === 0) return { claimed: 0, results: [] };

  const { data, error } = await deps.db.rpc("claim_supervised_actions", {
    p_action_types: types,
    p_limit: options.limit ?? 10,
    p_lease_seconds: 120,
    p_only: options.only ?? null,
  });
  if (error) {
    console.error("supervised claim failed", { code: error.code });
    return { claimed: 0, results: [] };
  }
  const claimed = ((data ?? []) as Row[]).map(toClaimed);
  const results: WorkerReport["results"] = [];
  for (const action of claimed) {
    const handler = HANDLERS[action.actionType];
    let result: HandlerResult;
    try {
      result = handler ? await handler(action, deps) : { outcome: "failed", error: "This action is not carried out automatically." };
    } catch (thrown) {
      // Something broke partway: whether the effect happened is unknown.
      console.error("supervised handler threw", { id: action.id, type: action.actionType });
      result = { outcome: "uncertain", error: thrown instanceof Error ? thrown.message.slice(0, 300) : "The executor stopped unexpectedly." };
    }
    const { data: finished, error: finishError } = await deps.db.rpc("finish_supervised_action", {
      p_proposal_id: action.id,
      p_claim_token: action.claimToken,
      p_outcome: result.outcome,
      p_external_ref: result.externalRef ?? null,
      p_receipt: result.receipt ?? null,
      p_error: result.error ?? null,
      p_retry_at: result.retryAt ?? null,
    });
    const row = (Array.isArray(finished) ? finished[0] : finished) as Row | null;
    if (finishError || row?.ok !== true) {
      // The lease ran out or the write failed. The claim sweep marks it
      // uncertain; the outcome above is kept in the log for whoever checks.
      console.error("supervised finish not recorded", { id: action.id, outcome: result.outcome, code: finishError?.code });
    }
    results.push({ id: action.id, outcome: result.outcome, status: text(row?.status) });
  }
  return { claimed: claimed.length, results };
}
