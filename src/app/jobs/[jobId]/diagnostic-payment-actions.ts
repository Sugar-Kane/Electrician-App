"use server";

import { revalidatePath } from "next/cache";

import { billingRefusal } from "@/lib/billing-permission-server";
import {
  collectDiagnosticPayment,
  completeDiagnostic,
  sendRecoveryLink,
  sendSetupRequest,
} from "@/lib/diagnostic-payment-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type DiagnosticPaymentActionState = { error: string; notice?: string };

/** The job, read through the signed-in member's own client (RLS scopes it to their business). */
async function ownJob(jobNumber: string) {
  const context = await currentContext();
  if (!context) return null;
  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", Number(jobNumber))
    .maybeSingle();
  const row = data as Record<string, unknown> | null;
  if (!row || typeof row.id !== "string") return null;
  const { data: booking } = await supabase
    .from("booking_requests")
    .select("public_token")
    .eq("organization_id", context.organizationId)
    .eq("created_job_id", row.id)
    .limit(1)
    .maybeSingle();
  const token = typeof (booking as Record<string, unknown> | null)?.public_token === "string" ? String((booking as Record<string, unknown>).public_token) : "";
  return { context, supabase, jobId: row.id, token };
}

/** Record the diagnostic as complete. The database checks the role and the findings. */
export async function completeDiagnosticAction(
  jobNumber: string,
  _previous: DiagnosticPaymentActionState,
  formData: FormData,
): Promise<DiagnosticPaymentActionState> {
  const job = await ownJob(jobNumber);
  if (!job) return { error: "That job could not be found." };
  const outcome = String(formData.get("outcome") ?? "");
  if (outcome !== "diagnostic_only" && outcome !== "fix_now" && outcome !== "schedule_later") {
    return { error: "Choose how the diagnostic ended." };
  }
  const result = await completeDiagnostic({
    database: job.supabase,
    organizationId: job.context.organizationId,
    jobId: job.jobId,
    outcome,
    findings: String(formData.get("findings") ?? ""),
    separateRepairContract: formData.get("separateContract") === "on",
  });
  revalidatePath(`/jobs/${jobNumber}`);
  return result.ok ? { error: "", notice: result.message } : { error: result.message };
}

/** Charge the authorized amount for a completed diagnostic. Billing permission required. */
export async function collectDiagnosticAction(jobNumber: string): Promise<DiagnosticPaymentActionState> {
  const blocked = await billingRefusal();
  if (blocked) return { error: blocked };
  const job = await ownJob(jobNumber);
  if (!job) return { error: "That job could not be found." };
  const result = await collectDiagnosticPayment({
    organizationId: job.context.organizationId,
    jobId: job.jobId,
    via: "app",
    actorId: job.context.userId,
    actor: { role: job.context.role, canBill: true },
  });
  revalidatePath(`/jobs/${jobNumber}`);
  return result.ok ? { error: "", notice: result.message } : { error: result.message };
}

export async function sendDiagnosticLinkAction(jobNumber: string, kind: "setup" | "recovery"): Promise<DiagnosticPaymentActionState> {
  const job = await ownJob(jobNumber);
  if (!job?.token) return { error: "This job has no online booking to send a link for." };
  if (kind === "setup") {
    const sent = await sendSetupRequest(job.token);
    return sent.sent ? { error: "", notice: "Secure setup link sent." } : { error: "The link could not be sent." };
  }
  const sent = await sendRecoveryLink(job.token);
  return sent.sent ? { error: "", notice: "Secure payment link sent." } : { error: sent.reason ?? "The link could not be sent." };
}
