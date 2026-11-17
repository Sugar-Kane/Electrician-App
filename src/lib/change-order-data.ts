import "server-only";

import { canEditBilling } from "@/lib/billing-permission";
import { techniciansCanEditBilling } from "@/lib/billing-permission-server";
import { loadJobChangeOrders, type JobChangeOrders } from "@/lib/change-orders-server";
import { currentContext } from "@/lib/request-context";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * A job's change orders for the job page, read through the person's session,
 * with whether they may set prices. Null for the signed-out demo view and for
 * a job that is not theirs.
 */
export async function getJobChangeOrders(jobNumber: string): Promise<(JobChangeOrders & { canSetPrices: boolean }) | null> {
  const context = await currentContext();
  if (!context) return null;
  const database = asFlexibleClient(await createClient());
  const loaded = await loadJobChangeOrders(database, context.organizationId, { jobNumber }).catch((error) => {
    // Before the migration runs there are no change order tables: the job page
    // still renders, without the section.
    console.error("change orders: could not be read", error);
    return null;
  });
  if (!loaded) return null;
  const canSetPrices = canEditBilling(
    context.role,
    context.role === "technician" ? await techniciansCanEditBilling(context.organizationId) : true,
  );
  return { ...loaded, canSetPrices };
}
