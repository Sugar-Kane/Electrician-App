"use server";

import { revalidatePath } from "next/cache";

import { billingRefusal } from "@/lib/billing-permission-server";
import { readPrice } from "@/lib/job-lines";
import type { PlanItemInput } from "@/lib/payment-plan";
import { recordActivity } from "@/lib/activity";
import { recordPrepayment, saveJobPaymentPlan, setPaymentWorkDone } from "@/lib/payment-plan-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Setting a job's payment plan (deposit, installments, balance) and recording
 * money received before the invoice. Billing changes: refused for a
 * technician where the owner has turned those off, and checked again by row
 * security in the database.
 */

export type PaymentPlanState = { error: string; notice?: string };

async function findJob(jobNumber: string) {
  const context = await currentContext();
  if (!context) return null;
  const numeric = Number(jobNumber);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const database = asFlexibleClient(await createClient());
  const { data } = await database
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();
  return data ? { context, database, jobId: String(data.id) } : null;
}

function readItems(raw: unknown): PlanItemInput[] | null {
  if (!Array.isArray(raw) || raw.length > 12) return null;
  const items: PlanItemInput[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") return null;
    const row = entry as Record<string, unknown>;
    const kind = row.kind === "deposit" || row.kind === "final" ? row.kind : "installment";
    const due = row.due === "on_signing" || row.due === "on_date" ? row.due : "on_completion";
    const amountType = row.amountType === "percent" ? "percent" : "fixed";
    items.push({
      kind,
      amountType,
      amountCents: typeof row.amountCents === "number" ? Math.round(row.amountCents) : null,
      percentBps: typeof row.percentBps === "number" ? Math.round(row.percentBps) : null,
      due,
      dueDate: typeof row.dueDate === "string" ? row.dueDate.slice(0, 10) : null,
    });
  }
  return items;
}

export async function savePaymentPlanAction(jobNumber: string, rawItems: unknown): Promise<PaymentPlanState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const found = await findJob(jobNumber);
  if (!found) return { error: "That job could not be found." };
  const items = readItems(rawItems);
  if (!items) return { error: "That payment plan could not be read." };

  const saved = await saveJobPaymentPlan(found.database, { organizationId: found.context.organizationId, jobId: found.jobId, items });
  if (!saved.ok) return { error: saved.error };
  revalidatePath(`/jobs/${jobNumber}`);
  return {
    error: "",
    notice: saved.payments
      ? "Payment plan saved. Draft the contract again so it shows the schedule."
      : "Saved: payment in full on completion.",
  };
}

/**
 * Text and email the customer a payment's pay link, now. Asking for money is a
 * billing change. The payment must be one of this job's, read through the
 * person's own session (row security), before the link goes out.
 */
export async function sendPayLinkAction(jobNumber: string, itemId: string): Promise<PaymentPlanState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const found = await findJob(jobNumber);
  if (!found) return { error: "That job could not be found." };
  const { data: item } = await found.database
    .from("job_payment_plan_items")
    .select("id")
    .eq("organization_id", found.context.organizationId)
    .eq("job_id", found.jobId)
    .eq("id", itemId)
    .maybeSingle();
  if (!item) return { error: "That payment is no longer in the plan. Refresh the page." };

  const { sendPaymentRequest } = await import("@/lib/job-prepayment-pay");
  const sent = await sendPaymentRequest(String(item.id), { byHand: true });
  if (!sent.ok) return { error: sent.message };
  revalidatePath(`/jobs/${jobNumber}`);
  const went = [sent.sms === "sent" ? "texted" : "", sent.email === "sent" ? "emailed" : ""].filter(Boolean);
  if (went.length === 0) return { error: `The pay link didn't go out. Text: ${sent.sms}. Email: ${sent.email}.` };
  const missed = [sent.sms !== "sent" ? `text ${sent.sms}` : "", sent.email !== "sent" ? `email ${sent.email}` : ""].filter(Boolean);
  return { error: "", notice: `Pay link ${went.join(" and ")} to the customer.${missed.length ? ` (Not sent: ${missed.join("; ")}.)` : ""}` };
}

/**
 * Mark the work a progress payment is for as done (or undo it). Only then can
 * the payment be asked for or paid: California forbids payments ahead of the
 * work performed. A billing change, recorded on the job's activity.
 */
export async function setPaymentWorkDoneAction(jobNumber: string, itemId: string, done: boolean): Promise<PaymentPlanState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const found = await findJob(jobNumber);
  if (!found) return { error: "That job could not be found." };
  const saved = await setPaymentWorkDone(found.database, {
    organizationId: found.context.organizationId,
    jobId: found.jobId,
    itemId,
    done,
    userId: found.context.userId ?? null,
  });
  if (!saved.ok) return { error: saved.error };
  await recordActivity(found.database, {
    organizationId: found.context.organizationId,
    actorUserId: found.context.userId ?? null,
    eventType: done ? "payment_work_done" : "payment_work_undone",
    label: done ? "Marked the work for a progress payment done" : "Unmarked the work for a progress payment",
    jobId: found.jobId,
    metadata: { plan_item_id: itemId },
  }).catch(() => undefined);
  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: done ? "Marked done. This payment can now be asked for." : "Unmarked. This payment can't be asked for until its work is marked done." };
}

export async function recordPrepaymentAction(_previous: PaymentPlanState, formData: FormData): Promise<PaymentPlanState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const jobNumber = String(formData.get("jobNumber") ?? "");
  const found = await findJob(jobNumber);
  if (!found) return { error: "That job could not be found." };
  const price = readPrice(String(formData.get("amount") ?? ""));
  if (price.state !== "set" || price.cents <= 0) return { error: "Enter the amount received, like 250.00." };
  const methodRaw = String(formData.get("method") ?? "");
  const method = methodRaw === "check" ? "check" : methodRaw === "other" ? "other" : "cash";

  const recorded = await recordPrepayment(found.database, {
    organizationId: found.context.organizationId,
    jobId: found.jobId,
    amountCents: price.cents,
    method,
    note: String(formData.get("note") ?? ""),
    userId: found.context.userId ?? null,
  });
  if (!recorded.ok) return { error: recorded.error };
  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: "Recorded. It comes off the invoice when the invoice is sent." };
}
