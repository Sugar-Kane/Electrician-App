"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";

import { billingRefusal } from "@/lib/billing-permission-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type CancellationActionState = { error: string; notice?: string };

const CHANNELS = new Set(["email", "mail", "fax", "in_person", "other"]);

async function jobFor(jobNumber: string) {
  if (!Number.isFinite(Number(jobNumber))) return null;
  const context = await currentContext();
  if (!context) return null;
  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", Number(jobNumber))
    .maybeSingle();
  const jobId = typeof (data as Record<string, unknown> | null)?.id === "string" ? String((data as Record<string, unknown>).id) : "";
  return jobId ? { context, supabase, jobId } : null;
}

/**
 * The customer cancelled some other way than their link: an email, a letter,
 * a fax, or the Notice of Cancellation handed over in person. Recorded with
 * the day it was received, which starts the 10-day refund clock. Billing
 * editors only (checked again in the database).
 */
export async function recordCancellationAction(_previous: CancellationActionState, formData: FormData): Promise<CancellationActionState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const contractId = String(formData.get("contractId") ?? "").trim();
  const channel = String(formData.get("channel") ?? "");
  const received = String(formData.get("receivedOn") ?? "");
  if (!CHANNELS.has(channel)) return { error: "Choose how the cancellation arrived." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(received)) return { error: "Give the date the cancellation was received." };
  const found = await jobFor(jobNumber);
  if (!found) return { error: "That job could not be found." };

  // Noon in the business's day, so the date is the one that was picked.
  const { startOfLocalDay } = await import("@/lib/ca-home-improvement");
  const receivedAt = new Date(startOfLocalDay(received, found.context.timeZone).getTime() + 12 * 3_600_000);
  const { data: cancelledId, error } = await found.supabase.rpc("record_contract_cancellation", {
    p_contract_id: contractId,
    p_channel: channel,
    p_received_at: receivedAt.toISOString(),
    p_note: String(formData.get("note") ?? "").slice(0, 1000),
  });
  if (error || typeof cancelledId !== "string" || !cancelledId) {
    return { error: "The cancellation could not be recorded. The contract may not be signed, or it was already cancelled." };
  }
  after(async () => {
    const { notifyContractCancelled } = await import("@/lib/contract-cancellation-server");
    await notifyContractCancelled({ organizationId: found.context.organizationId, contractId: cancelledId }).catch((failure) =>
      console.error("contract cancellation notice failed", failure),
    );
  });
  revalidatePath(`/jobs/${jobNumber}`);
  return { error: "", notice: "Cancellation recorded. Refund everything the customer paid within 10 days." };
}

/** "Refund all payments" after a cancellation (contract-cancellation-server.ts). */
export async function refundAllPaymentsAction(_previous: CancellationActionState, formData: FormData): Promise<CancellationActionState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const found = await jobFor(jobNumber);
  if (!found) return { error: "That job could not be found." };
  const { refundCancelledContract } = await import("@/lib/contract-cancellation-server");
  const result = await refundCancelledContract(found.supabase, {
    organizationId: found.context.organizationId,
    jobId: found.jobId,
    userId: found.context.userId,
  });
  revalidatePath(`/jobs/${jobNumber}`);
  return result.ok ? { error: "", notice: result.message } : { error: result.message };
}
