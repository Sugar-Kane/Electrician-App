"use server";

import { revalidatePath } from "next/cache";

import { getJobDiagnosticPayment, refundDiagnosticFee } from "@/lib/booking-refund-server";
import { checkRefund } from "@/lib/invoice-refund";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export type DiagnosticRefundState = { error: string; notice?: string };

/**
 * Refund some or all of the diagnostic fee a customer paid online at booking
 * (booking-refund-server.ts). Owner or admin only; the database checks that
 * again, and that the fee still holds the amount.
 */
export async function refundDiagnosticFeeAction(
  _previous: DiagnosticRefundState,
  formData: FormData,
): Promise<DiagnosticRefundState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const paymentId = String(formData.get("paymentId") ?? "").trim();
  if (!jobNumber || !paymentId || !Number.isFinite(Number(jobNumber))) return { error: "That payment could not be found." };
  const context = await currentContext();
  if (!context) return { error: "Sign in first." };

  const supabase = asFlexibleClient(await createClient());
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", Number(jobNumber))
    .maybeSingle();
  const jobId = typeof (job as Record<string, unknown> | null)?.id === "string" ? String((job as Record<string, unknown>).id) : "";
  if (!jobId) return { error: "That job could not be found." };

  const payment = await getJobDiagnosticPayment(supabase, context.organizationId, jobId);
  if (!payment || payment.id !== paymentId) return { error: "That payment could not be found." };

  const check = checkRefund({
    canRefund: context.role === "owner" || context.role === "admin",
    // What already came off an invoice was given back as a credit; it cannot
    // be refunded as well.
    paymentCents: Math.max(0, payment.amountCents - payment.creditUsedCents),
    refunds: payment.refunds,
    amountText: String(formData.get("amount") ?? ""),
  });
  if (!check.ok) return { error: check.reason };

  const outcome = await refundDiagnosticFee(supabase, {
    paymentId,
    amountCents: check.amountCents,
    reason: String(formData.get("reason") ?? "").trim().slice(0, 300),
  });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  return outcome.ok ? { error: "", notice: outcome.message } : { error: outcome.message };
}
