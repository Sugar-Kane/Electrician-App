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
    notifyCustomer: formData.get("notifyCustomer") === "on",
  });

  revalidatePath(`/jobs/${jobNumber}`);
  revalidatePath("/invoices");
  revalidatePath("/");
  return outcome.ok ? { error: "", notice: outcome.message } : { error: outcome.message };
}

/**
 * Tell the customer about a diagnostic fee refund that went through without a
 * notice (one given before notices existed, or one whose notice failed or was
 * skipped). Owner or admin only, and only for a refund of this business.
 */
export async function sendDiagnosticRefundNoticeAction(
  _previous: DiagnosticRefundState,
  formData: FormData,
): Promise<DiagnosticRefundState> {
  const jobNumber = String(formData.get("jobNumber") ?? "").trim();
  const refundId = String(formData.get("refundId") ?? "").trim();
  if (!jobNumber || !refundId) return { error: "That refund could not be found." };
  const context = await currentContext();
  if (!context) return { error: "Sign in first." };
  if (context.role !== "owner" && context.role !== "admin") return { error: "Only the owner or an admin can send this." };

  // Read through the signed-in person's own client: a refund of another
  // business is simply not found.
  const supabase = asFlexibleClient(await createClient());
  const { data: refund } = await supabase
    .from("booking_payment_refunds")
    .select("id, status, customer_notice")
    .eq("organization_id", context.organizationId)
    .eq("id", refundId)
    .maybeSingle();
  const row = (refund ?? null) as Record<string, unknown> | null;
  if (!row) return { error: "That refund could not be found." };
  if (row.status !== "succeeded" && row.status !== "pending") return { error: "This refund did not go through, so there is nothing to tell them." };
  if (row.customer_notice === "sent" || row.customer_notice === "sending") return { error: "The customer was already told about this refund." };

  // Reopen a failed or skipped notice so it can be claimed and sent once.
  const { getSupabaseAdmin } = await import("@/lib/supabase/admin");
  await getSupabaseAdmin()
    .from("booking_payment_refunds")
    .update({ customer_notice: null })
    .eq("id", refundId)
    .eq("organization_id", context.organizationId)
    .in("customer_notice", ["failed", "skipped"]);
  const { sendBookingRefundNotice } = await import("@/lib/refund-notice");
  const told = await sendBookingRefundNotice(refundId);
  revalidatePath(`/jobs/${jobNumber}`);
  const by = [told.email === "sent" ? "email" : "", told.sms === "sent" ? "text" : ""].filter(Boolean);
  return by.length > 0
    ? { error: "", notice: `The customer was told by ${by.join(" and ")}.` }
    : { error: `The customer could not be told (email: ${told.email}; text: ${told.sms}).` };
}
