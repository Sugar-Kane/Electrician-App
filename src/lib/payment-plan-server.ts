import "server-only";

import { lineTotalCents } from "@/lib/job-lines";
import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { doneProgressCents, paymentsOwed, planAmounts, preWorkRefusal, type PlanItemInput, type PlannedPayment } from "@/lib/payment-plan";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Loading and saving a job's payment plan, and what has been paid against it
 * before the invoice. The rules are in payment-plan.ts; this only reads and
 * writes. Every query is scoped to the business; row security does the rest.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type Prepayment = { id: string; amountCents: number; method: string; receivedAt: string; applied: boolean; note: string };

/** A saved payment as the customer is asked for it: its pay link, when it was asked for, and what is still owed on it. */
export type SavedPayment = { id: string; payToken: string; requestedAt: string | null; owedCents: number; paid: boolean; doneAt: string | null };

export type JobPaymentPlan = {
  /** One a payment, aligned with `payments`, when the saved plan fits the total. */
  saved: SavedPayment[];
  /** The job's priced total today: what a percentage is of. */
  totalCents: number;
  /** As saved; empty means payment in full on completion. */
  items: PlanItemInput[];
  /** The items as amounts, when they still fit the total. */
  payments: PlannedPayment[] | null;
  /** Why the saved plan no longer fits (the job's price changed), or "". */
  problem: string;
  prepayments: Prepayment[];
  prepaidCents: number;
};

/** What the job's work and parts come to, before any invoice credits. */
async function jobTotalCents(database: FlexibleSupabaseClient, organizationId: string, jobId: string): Promise<number> {
  const { data, error } = await database
    .from("job_line_items")
    .select("quantity, unit_price_cents")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId);
  if (error) throw new Error(`job total could not be read: ${error.message}`);
  return ((data ?? []) as Row[]).reduce(
    (sum, line) => sum + lineTotalCents({ quantity: num(line.quantity), unitPriceCents: num(line.unit_price_cents) }),
    0,
  );
}

function toItem(row: Row): PlanItemInput {
  return {
    kind: (text(row.kind) || "installment") as PlanItemInput["kind"],
    amountType: text(row.amount_type) === "percent" ? "percent" : "fixed",
    amountCents: row.amount_cents === null ? null : num(row.amount_cents),
    percentBps: row.percent_bps === null ? null : num(row.percent_bps),
    due: (text(row.due) || "on_completion") as PlanItemInput["due"],
    dueDate: text(row.due_date) || null,
    doneAt: text(row.done_at) || null,
    phase: text(row.phase) || null,
  };
}

export async function loadJobPaymentPlan(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string },
): Promise<JobPaymentPlan> {
  // Throws on any failed read: a balance worked out from missing rows (no
  // prepayments read as none paid) would ask for money already paid.
  const [totalCents, { data: itemRows, error: itemError }, { data: prepaidRows, error: prepaidError }] = await Promise.all([
    jobTotalCents(database, input.organizationId, input.jobId),
    database
      .from("job_payment_plan_items")
      .select("id, pay_token, requested_at, kind, amount_type, amount_cents, percent_bps, due, due_date, done_at, phase, position")
      .eq("organization_id", input.organizationId)
      .eq("job_id", input.jobId)
      .order("position", { ascending: true }),
    database
      .from("job_prepayments")
      .select("id, amount_cents, method, received_at, applied_at, note")
      .eq("organization_id", input.organizationId)
      .eq("job_id", input.jobId)
      .order("received_at", { ascending: true }),
  ]);
  if (itemError) throw new Error(`payment plan could not be read: ${itemError.message}`);
  if (prepaidError) throw new Error(`prepayments could not be read: ${prepaidError.message}`);
  const rows = (itemRows ?? []) as Row[];
  const items = rows.map(toItem);
  const planned = items.length > 0 ? planAmounts(totalCents, items) : null;
  const prepayments = ((prepaidRows ?? []) as Row[]).map((row) => ({
    id: text(row.id),
    amountCents: num(row.amount_cents),
    method: text(row.method),
    receivedAt: text(row.received_at),
    applied: Boolean(text(row.applied_at)),
    note: text(row.note),
  }));
  const prepaidCents = prepayments.reduce((sum, payment) => sum + payment.amountCents, 0);
  const owed = planned && planned.ok ? paymentsOwed(planned.payments, prepaidCents) : [];
  return {
    saved: owed.map((each, index) => ({
      id: text(rows[index]?.id),
      payToken: text(rows[index]?.pay_token),
      requestedAt: text(rows[index]?.requested_at) || null,
      owedCents: each.owedCents,
      paid: each.paid,
      doneAt: text(rows[index]?.done_at) || null,
    })),
    totalCents,
    items,
    payments: planned && planned.ok ? planned.payments : null,
    problem: planned && !planned.ok ? planned.reason : "",
    prepayments,
    prepaidCents,
  };
}

/**
 * Replace the job's plan. An empty list is "payment in full on completion".
 * Checked against the job's total before anything is written.
 */
export async function saveJobPaymentPlan(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; items: PlanItemInput[] },
): Promise<{ ok: true; payments: PlannedPayment[] | null } | { ok: false; error: string }> {
  let payments: PlannedPayment[] | null = null;
  if (input.items.length > 0) {
    let total: number;
    try {
      total = await jobTotalCents(database, input.organizationId, input.jobId);
    } catch (error) {
      console.error("payment plan: job total could not be read", error);
      return { ok: false, error: "The job's price could not be read. Try again." };
    }
    const planned = planAmounts(total, input.items);
    if (!planned.ok) return { ok: false, error: planned.reason };
    payments = planned.payments;
  }

  // Payments are kept by their place in the plan, so a pay link already sent
  // keeps working when the plan is saved again. Places past the new plan's end
  // go; the rest are updated in place.
  const { data: existingRows, error: readError } = await database
    .from("job_payment_plan_items")
    .select("position, kind, due, due_date, requested_at, amount_type, amount_cents, percent_bps, done_at, done_by")
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId);
  if (readError) {
    console.error("payment plan: could not be read before saving", readError);
    return { ok: false, error: "The payment plan could not be saved. Try again." };
  }
  const existing = new Map(((existingRows ?? []) as Row[]).map((row) => [num(row.position), row]));

  const { error: clearError } = await database
    .from("job_payment_plan_items")
    .delete()
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId)
    .gte("position", payments?.length ?? 0);
  if (clearError) {
    console.error("payment plan: could not be cleared", clearError);
    return { ok: false, error: "The payment plan could not be saved. Your business may limit billing changes to the owner." };
  }
  if (!payments) return { ok: true, payments: null };

  const { error } = await database.from("job_payment_plan_items").upsert(
    payments.map((payment, position) => {
      const before = existing.get(position);
      const dueDate = payment.due === "on_date" ? payment.dueDate ?? null : null;
      // Asked for already, and still the same payment: not asked for again.
      const same =
        before && text(before.kind) === payment.kind && text(before.due) === payment.due && (text(before.due_date) || null) === dueDate;
      return {
        organization_id: input.organizationId,
        job_id: input.jobId,
        position,
        kind: payment.kind,
        amount_type: payment.kind === "final" ? "fixed" : payment.amountType,
        // The balance is worked out from the total each time; it is not stored as a figure.
        amount_cents: payment.kind === "final" ? null : payment.amountType === "fixed" ? payment.cents : null,
        percent_bps: payment.kind !== "final" && payment.amountType === "percent" ? payment.percentBps : null,
        due: payment.due,
        due_date: dueDate,
        requested_at: same ? text(before.requested_at) || null : null,
        phase: payment.phase?.replace(/\s+/g, " ").trim().slice(0, 300) || null,
        // Work marked done stays marked only while the payment is unchanged.
        ...doneKept(before, payment, Boolean(same)),
      };
    }),
    { onConflict: "job_id,position" },
  );
  if (error) {
    console.error("payment plan: could not be saved", error);
    return { ok: false, error: "The payment plan could not be saved. Try again." };
  }
  return { ok: true, payments };
}

/** The "work done" mark carried over when a payment is saved again unchanged, else cleared. */
function doneKept(before: Row | undefined, payment: PlannedPayment, same: boolean): { done_at: string | null; done_by: string | null } {
  const unchanged =
    same &&
    before !== undefined &&
    (text(before.amount_type) || "fixed") === (payment.kind === "final" ? "fixed" : payment.amountType) &&
    (payment.kind === "final" ||
      (payment.amountType === "fixed" ? num(before.amount_cents) === payment.cents : num(before.percent_bps) === num(payment.percentBps)));
  return unchanged && text(before?.done_at)
    ? { done_at: text(before?.done_at), done_by: text(before?.done_by) || null }
    : { done_at: null, done_by: null };
}

/**
 * What may still be taken on a job before it is complete, worked out from the
 * newest signed contract's price (else the job's priced total), the progress
 * payments marked done, what has been taken or is on its way, and any paid
 * diagnostic fee still to be credited. California B&P 7159.5.
 */
export async function preWorkCheck(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; proposedCents: number; pendingCents?: number },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [{ data: jobRow, error: jobError }, { data: contractRow, error: contractError }] = await Promise.all([
    database
      .from("jobs")
      .select("id, status, follow_up_of, diagnostic_paid, diagnostic_fee_cents")
      .eq("organization_id", input.organizationId)
      .eq("id", input.jobId)
      .maybeSingle(),
    database
      .from("contracts")
      .select("total_cents")
      .eq("organization_id", input.organizationId)
      .eq("job_id", input.jobId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (jobError || contractError || !jobRow) return { ok: false, error: "The job could not be read. Try again." };
  const job = jobRow as Row;
  if (text(job.status) === "completed") return { ok: true };
  let plan: JobPaymentPlan;
  try {
    plan = await loadJobPaymentPlan(database, { organizationId: input.organizationId, jobId: input.jobId });
  } catch (error) {
    console.error("pre-work check: plan could not be read", error);
    return { ok: false, error: "What has been paid on this job could not be read. Try again." };
  }
  // The limit is for work under a contract: a job with a signed contract or a
  // payment plan. A service call billed on the spot has neither.
  if (!contractRow && plan.items.length === 0) return { ok: true };
  const signedTotal = num((contractRow as Row | null)?.total_cents);
  const diagnosticCreditCents = await diagnosticCreditLeft(database, input.organizationId, {
    id: input.jobId,
    followUpOf: text(job.follow_up_of) || null,
    diagnosticPaid: job.diagnostic_paid === true,
    diagnosticFeeCents: num(job.diagnostic_fee_cents),
  }).catch(() => 0);
  const refusal = preWorkRefusal({
    contractTotalCents: signedTotal > 0 ? signedTotal : plan.totalCents,
    doneCents: plan.payments ? doneProgressCents(plan.payments) : 0,
    collectedCents: plan.prepaidCents + Math.max(0, num(input.pendingCents)),
    diagnosticCreditCents,
    completed: false,
    proposedCents: input.proposedCents,
  });
  return refusal ? { ok: false, error: refusal } : { ok: true };
}

/**
 * Whether an invoice may be sent before its job is complete: what it asks for,
 * with the job's other invoices already out, may not run ahead of the down
 * payment allowance plus the work marked done (B&P 7159.5). Only for work under
 * a signed contract or a payment plan; a completed job is billed in full.
 */
export async function invoiceSendCheck(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; invoiceId: string },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: invoiceRow, error: invoiceError } = await database
    .from("invoices")
    .select("id, job_id, total_cents, diagnostic_credit_cents")
    .eq("organization_id", input.organizationId)
    .eq("id", input.invoiceId)
    .maybeSingle();
  if (invoiceError) return { ok: false, error: "The invoice could not be read. Nothing was sent." };
  const invoice = (invoiceRow ?? null) as Row | null;
  const jobId = text(invoice?.job_id);
  if (!invoice || !jobId) return { ok: true };
  const [{ data: jobRow, error: jobError }, { data: contractRow, error: contractError }, { data: otherRows, error: otherError }] = await Promise.all([
    database.from("jobs").select("status").eq("organization_id", input.organizationId).eq("id", jobId).maybeSingle(),
    database
      .from("contracts")
      .select("total_cents")
      .eq("organization_id", input.organizationId)
      .eq("job_id", jobId)
      .not("signed_at", "is", null)
      .order("signed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    database
      .from("invoices")
      .select("id, total_cents")
      .eq("organization_id", input.organizationId)
      .eq("job_id", jobId)
      .not("status", "in", "(draft,void)")
      .neq("id", input.invoiceId),
  ]);
  if (jobError || contractError || otherError) return { ok: false, error: "The job could not be read. Nothing was sent." };
  if (text((jobRow as Row | null)?.status) === "completed") return { ok: true };
  let plan: JobPaymentPlan;
  try {
    plan = await loadJobPaymentPlan(database, { organizationId: input.organizationId, jobId });
  } catch {
    return { ok: false, error: "What has been paid on this job could not be read. Nothing was sent." };
  }
  if (!contractRow && plan.items.length === 0) return { ok: true };
  const signedTotal = num((contractRow as Row | null)?.total_cents);
  const refusal = preWorkRefusal({
    contractTotalCents: signedTotal > 0 ? signedTotal : plan.totalCents,
    doneCents: plan.payments ? doneProgressCents(plan.payments) : 0,
    // Prepayments are applied into an invoice when it is sent, so what earlier
    // invoices ask for already includes them.
    collectedCents: ((otherRows ?? []) as Row[]).reduce((sum, row) => sum + num(row.total_cents), 0),
    diagnosticCreditCents: num(invoice.diagnostic_credit_cents),
    completed: false,
    proposedCents: num(invoice.total_cents),
  });
  return refusal ? { ok: false, error: `${refusal} Nothing was sent.` } : { ok: true };
}

/** Mark (or unmark) the work a progress payment is for as done. Billing editors only (row security). */
export async function setPaymentWorkDone(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; itemId: string; done: boolean; userId: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  const { data: row, error: readError } = await database
    .from("job_payment_plan_items")
    .select("id, kind, due")
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId)
    .eq("id", input.itemId)
    .maybeSingle();
  if (readError || !row) return { ok: false, error: "That payment is no longer in the job's plan." };
  const item = row as Row;
  if (text(item.kind) !== "installment" || text(item.due) === "on_signing") {
    return { ok: false, error: "Only a progress payment is marked done. The deposit is due on signing and the balance on completion." };
  }
  const { data: updated, error } = await database
    .from("job_payment_plan_items")
    .update(input.done ? { done_at: new Date().toISOString(), done_by: input.userId } : { done_at: null, done_by: null })
    .eq("organization_id", input.organizationId)
    .eq("id", input.itemId)
    .select("id")
    .maybeSingle();
  if (error || !updated) {
    console.error("payment plan: work done could not be saved", error);
    return { ok: false, error: "That could not be saved. Your business may limit billing changes to the owner." };
  }
  return { ok: true };
}

/** Money received before the invoice, in cash or by check: kept until the invoice is sent. */
export async function recordPrepayment(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; amountCents: number; method: "cash" | "check" | "other"; note: string; userId: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: "Enter the amount received." };
  const allowed = await preWorkCheck(database, { organizationId: input.organizationId, jobId: input.jobId, proposedCents: input.amountCents });
  if (!allowed.ok) return allowed;
  const { error } = await database.from("job_prepayments").insert({
    organization_id: input.organizationId,
    job_id: input.jobId,
    amount_cents: input.amountCents,
    method: input.method,
    note: input.note.trim().slice(0, 300) || null,
    recorded_by: input.userId,
  });
  if (error) {
    console.error("payment plan: prepayment could not be recorded", error);
    return { ok: false, error: "That payment could not be recorded. Your business may limit billing changes to the owner." };
  }
  return { ok: true };
}
