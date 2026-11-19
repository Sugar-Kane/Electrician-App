import "server-only";

import { canEditBilling } from "@/lib/billing-permission";
import { techniciansCanEditBilling } from "@/lib/billing-permission-server";
import { loadJobPaymentPlan, type JobPaymentPlan } from "@/lib/payment-plan-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/** The job page's payment plan, and whether this person may change it. Null before the migration runs. */
export async function getJobPaymentPlan(jobNumber: string): Promise<(JobPaymentPlan & { canEdit: boolean }) | null> {
  const context = await currentContext();
  if (!context) return null;
  const numeric = Number(jobNumber);
  if (!Number.isInteger(numeric) || numeric <= 0) return null;
  const database = asFlexibleClient(await createClient());
  const { data: job } = await database
    .from("jobs")
    .select("id")
    .eq("organization_id", context.organizationId)
    .eq("job_number", numeric)
    .maybeSingle();
  if (!job) return null;
  try {
    const plan = await loadJobPaymentPlan(database, { organizationId: context.organizationId, jobId: String(job.id) });
    const canEdit = canEditBilling(
      context.role,
      context.role === "technician" ? await techniciansCanEditBilling(context.organizationId) : true,
    );
    return { ...plan, canEdit };
  } catch (error) {
    console.error("payment plan: could not be read", error);
    return null;
  }
}
