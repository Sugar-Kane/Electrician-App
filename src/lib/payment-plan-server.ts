import "server-only";

import { lineTotalCents } from "@/lib/job-lines";
import { paymentsOwed, planAmounts, type PlanItemInput, type PlannedPayment } from "@/lib/payment-plan";
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
export type SavedPayment = { id: string; payToken: string; requestedAt: string | null; owedCents: number; paid: boolean };

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
  const { data } = await database
    .from("job_line_items")
    .select("quantity, unit_price_cents")
    .eq("organization_id", organizationId)
    .eq("job_id", jobId);
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
  };
}

export async function loadJobPaymentPlan(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string },
): Promise<JobPaymentPlan> {
  const [totalCents, { data: itemRows }, { data: prepaidRows }] = await Promise.all([
    jobTotalCents(database, input.organizationId, input.jobId),
    database
      .from("job_payment_plan_items")
      .select("id, pay_token, requested_at, kind, amount_type, amount_cents, percent_bps, due, due_date, position")
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
    const total = await jobTotalCents(database, input.organizationId, input.jobId);
    const planned = planAmounts(total, input.items);
    if (!planned.ok) return { ok: false, error: planned.reason };
    payments = planned.payments;
  }

  // Payments are kept by their place in the plan, so a pay link already sent
  // keeps working when the plan is saved again. Places past the new plan's end
  // go; the rest are updated in place.
  const { data: existingRows, error: readError } = await database
    .from("job_payment_plan_items")
    .select("position, kind, due, due_date, requested_at")
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

/** Money received before the invoice, in cash or by check: kept until the invoice is sent. */
export async function recordPrepayment(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; amountCents: number; method: "cash" | "check" | "other"; note: string; userId: string | null },
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) return { ok: false, error: "Enter the amount received." };
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
