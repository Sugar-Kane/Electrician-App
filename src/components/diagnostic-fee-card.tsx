import { DiagnosticFeeRefund } from "@/components/diagnostic-fee-refund";
import { getJobDiagnosticPayment } from "@/lib/booking-refund-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * The job's diagnostic fee paid online at booking, with its refunds and the
 * Refund button. Nothing at all for a job with no such payment.
 */
export async function DiagnosticFeeCard({ jobNumber }: { jobNumber: string }) {
  const numeric = Number(jobNumber);
  if (!Number.isFinite(numeric)) return null;
  const context = await currentContext();
  if (!context) return null;

  const supabase = asFlexibleClient(await createClient());
  const { data: job } = await supabase
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();
  const jobId = (job as Record<string, unknown> | null)?.id;
  if (typeof jobId !== "string") return null;

  const payment = await getJobDiagnosticPayment(supabase, context.organizationId, jobId);
  if (!payment) return null;

  return (
    <DiagnosticFeeRefund
      jobNumber={jobNumber}
      payment={payment}
      canRefund={context.role === "owner" || context.role === "admin"}
    />
  );
}
