import "server-only";

import { BILLING_LOCKED_MESSAGE, canEditBilling } from "@/lib/billing-permission";
import { currentContext } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
import { asFlexibleClient } from "@/lib/supabase/flexible";

/** Whether this business lets technicians change billing. On unless an owner turned it off. */
export async function techniciansCanEditBilling(organizationId: string): Promise<boolean> {
  const { data } = await asFlexibleClient(getSupabaseAdmin())
    .from("organizations")
    .select("technicians_can_edit_billing")
    .eq("id", organizationId)
    .maybeSingle();
  return (data as Record<string, unknown> | null)?.technicians_can_edit_billing !== false;
}

/** Why the signed-in person may not change billing, or "" when they may. */
export async function billingRefusal(): Promise<string> {
  const context = await currentContext();
  if (!context) return "Sign in first.";
  if (context.role !== "technician") return "";
  return canEditBilling(context.role, await techniciansCanEditBilling(context.organizationId)) ? "" : BILLING_LOCKED_MESSAGE;
}
