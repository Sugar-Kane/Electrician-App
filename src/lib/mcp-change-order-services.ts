import "server-only";

import { canEditBilling } from "@/lib/billing-permission";
import { techniciansCanEditBilling } from "@/lib/billing-permission-server";
import {
  addChangeOrderItem,
  createChangeOrder,
  loadChangeOrder,
  loadJobChangeOrders,
  removeChangeOrderItem,
  requestChangeOrderApproval,
  updateChangeOrder,
} from "@/lib/change-orders-server";
import { findInvoiceId, invoiceSummary, setInvoiceDiscount } from "@/lib/invoice-adjustments-server";
import type { ChangeOrderToolContext } from "@/lib/mcp-change-order-tools";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * The change order tools' services, bound to one business and to the person
 * who connected the assistant.
 *
 * The service role is used (there is no user session behind an MCP call), so
 * every function is scoped to the business explicitly, and billing permission
 * comes from the connected person's own membership — never from anything the
 * request says. A connection whose person is no longer a member can set no
 * prices and no discounts.
 */
export async function changeOrderToolContext(input: {
  database: FlexibleSupabaseClient;
  organizationId: string;
  actorUserId: string | null;
}): Promise<ChangeOrderToolContext> {
  const { database, organizationId, actorUserId } = input;
  let billing = false;
  if (actorUserId) {
    const { data: member } = await database
      .from("organization_members")
      .select("role")
      .eq("organization_id", organizationId)
      .eq("user_id", actorUserId)
      .maybeSingle();
    const role = typeof member?.role === "string" ? member.role : "";
    billing = canEditBilling(role, role === "technician" ? await techniciansCanEditBilling(organizationId) : true);
  }
  const actor = { userId: actorUserId, canSetPrices: billing };

  return {
    canEditBilling: billing,
    services: {
      loadJob: (jobNumber) => loadJobChangeOrders(database, organizationId, { jobNumber }),
      loadOrder: (changeOrderId) => loadChangeOrder(database, organizationId, changeOrderId),
      create: (create) =>
        createChangeOrder(database, {
          organizationId,
          job: { jobNumber: create.jobNumber },
          userId: actorUserId,
          description: create.description,
          reason: create.reason,
          contractId: create.contractId,
        }),
      addItem: (changeOrderId, item) => addChangeOrderItem(database, { organizationId, changeOrderId, actor, item }),
      update: (changeOrderId, update) => updateChangeOrder(database, { organizationId, changeOrderId, ...update }),
      removeItem: (changeOrderId, itemId) => removeChangeOrderItem(database, { organizationId, changeOrderId, itemId }),
      requestApproval: (changeOrderId) => requestChangeOrderApproval(database, { organizationId, changeOrderId, userId: actorUserId }),
      findInvoice: (find) => findInvoiceId(database, organizationId, find),
      invoiceSummary: (invoiceId) => invoiceSummary(database, organizationId, invoiceId),
      setDiscount: (invoiceId, discount) =>
        setInvoiceDiscount(database, { organizationId, invoiceId, ...discount, actorUserId }),
    },
  };
}
