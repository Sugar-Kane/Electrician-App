"use server";

import { revalidatePath } from "next/cache";

import { billingRefusal } from "@/lib/billing-permission-server";
import { readPrice } from "@/lib/job-lines";
import type { PlanItemInput } from "@/lib/payment-plan";
import { recordPrepayment, saveJobPaymentPlan } from "@/lib/payment-plan-server";
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
