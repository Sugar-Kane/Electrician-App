import "server-only";

import { recordActivity } from "@/lib/activity";
import { checkCustomerDetails, detailsFromRow, detailsToRow, type CustomerDetails } from "@/lib/customer-details";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Saving a customer's details, for the customer page (the signed-in person's
 * own client, so row-level security applies too) and ChatGPT/Claude (the
 * server client). Always filtered to the business; the rules are
 * `checkCustomerDetails`.
 */

export const CUSTOMER_DETAIL_COLUMNS =
  "id, first_name, last_name, company_name, phone, email, preferred_contact, address_line_1, address_line_2, city, state, postal_code, business_address_line_1, business_address_line_2, business_city, business_state, business_postal_code, bill_to";

export async function loadCustomerDetails(
  db: FlexibleSupabaseClient,
  organizationId: string,
  customerId: string,
): Promise<CustomerDetails | null> {
  if (!/^[0-9a-f-]{36}$/i.test(customerId)) return null;
  const { data } = await db.from("customers").select(CUSTOMER_DETAIL_COLUMNS).eq("organization_id", organizationId).eq("id", customerId).maybeSingle();
  return data ? detailsFromRow(data as Record<string, unknown>) : null;
}

export async function saveCustomerDetails(
  db: FlexibleSupabaseClient,
  input: { organizationId: string; customerId: string; details: CustomerDetails; via: "app" | "chatgpt" },
): Promise<{ ok: true; details: CustomerDetails } | { ok: false; reason: string; field?: string }> {
  const checked = checkCustomerDetails(input.details);
  if (!checked.ok) return checked;
  const { data, error } = await db
    .from("customers")
    .update({ ...detailsToRow(checked.details), updated_at: new Date().toISOString() })
    .eq("organization_id", input.organizationId)
    .eq("id", input.customerId)
    .select("id")
    .maybeSingle();
  if (error) {
    console.error("customer details save failed", { code: error.code });
    return { ok: false, reason: "The details could not be saved. Try again." };
  }
  if (!data) return { ok: false, reason: "That customer could not be found." };
  await recordActivity(db, {
    organizationId: input.organizationId,
    eventType: "customer.updated",
    label: "Customer details updated",
    customerId: input.customerId,
    metadata: { via: input.via, bill_to: checked.details.billTo },
  });
  return { ok: true, details: checked.details };
}
