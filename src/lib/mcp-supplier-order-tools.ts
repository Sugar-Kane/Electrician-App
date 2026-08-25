import "server-only";

import type { McpTool, ToolResult } from "@/lib/mcp-protocol";
import type { McpSession } from "@/lib/mcp-session-token";
import { formatMoney } from "@/lib/invoice-messages";
import { getSupabaseAdmin } from "@/lib/supabase/admin";

const confirmed = {
  type: "boolean",
  description: "True only after the owner explicitly approves this exact order action.",
};

export const SUPPLIER_ORDER_MCP_TOOLS: McpTool[] = [
  {
    name: "prepare_supplier_order",
    title: "Prepare supplier order",
    description: "Create a reviewable supplier order from the products already selected for a job. Nothing is purchased.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: { type: "string" },
        supplier: { type: "string", enum: ["lowes", "home-depot"] },
        confirmed,
      },
      required: ["job_number", "supplier", "confirmed"],
      additionalProperties: false,
    },
  },
  {
    name: "list_supplier_orders",
    title: "List supplier orders",
    description: "List recent supplier order drafts and their current status.",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["all", "draft", "approved", "submitted", "ordered", "failed", "cancelled"] } },
      required: ["status"],
      additionalProperties: false,
    },
  },
  {
    name: "submit_supplier_order",
    title: "Submit supplier order",
    description: "Approve and submit a prepared supplier order. This only places an external order when a supported server-side retailer checkout adapter is configured.",
    inputSchema: {
      type: "object",
      properties: { order_id: { type: "string" }, confirmed },
      required: ["order_id", "confirmed"],
      additionalProperties: false,
    },
  },
];

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function confirmation(args: Record<string, unknown>, proposal: string): ToolResult | null {
  return args.confirmed === true
    ? null
    : { text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: ${proposal}` };
}

async function checkoutPreparedOrder(input: {
  supplier: string;
  orderId: string;
}): Promise<{ ok: boolean; orderId?: string; checkoutUrl?: string; reason?: string }> {
  // Deliberately fail closed. Product-discovery/feed credentials are not checkout
  // credentials, and retailer schemas cannot be guessed safely. A retailer-specific
  // adapter can replace this once Volteira is issued documented ordering access.
  return {
    ok: false,
    reason: `${input.supplier === "lowes" ? "Lowe’s" : "Home Depot"} checkout access is not configured. The order remains approved in Volteira and has not been purchased.`,
  };
}

export async function runSupplierOrderMcpTool(input: {
  database: ReturnType<typeof getSupabaseAdmin>;
  session: McpSession;
  name: string;
  args: Record<string, unknown>;
}): Promise<ToolResult> {
  const { database, session, name, args } = input;
  if (session.scope !== "business") return { isError: true, text: "This connection is booking-only." };
  const organizationId = session.organizationId;

  if (name === "prepare_supplier_order") {
    const jobNumber = Number(text(args.job_number));
    const supplier = text(args.supplier);
    const gate = confirmation(args, `Prepare a ${supplier} order for job #${text(args.job_number)} from its selected products.`);
    if (gate) return gate;
    if (!Number.isFinite(jobNumber)) return { isError: true, text: "That job number could not be read." };

    const { data: job } = await database
      .from("jobs")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("job_number", jobNumber)
      .maybeSingle();
    if (!job) return { isError: true, text: `Job #${jobNumber} was not found.` };

    const { data: selections } = await database
      .from("supplier_product_selections")
      .select("material_name,product_name,product_url,retailer_sku,quantity,unit_price_cents,availability,store_name,store_number")
      .eq("organization_id", organizationId)
      .eq("job_id", String(job.id))
      .eq("supplier", supplier)
      .is("archived_at", null);
    const rows = (selections ?? []) as Record<string, unknown>[];
    if (rows.length === 0) return { isError: true, text: `No ${supplier} products are selected for job #${jobNumber}. Nothing was prepared.` };

    const subtotal = rows.reduce((sum, row) => sum + Math.round(Number(row.quantity ?? 0) * Number(row.unit_price_cents ?? 0)), 0);
    const { data: order, error } = await database
      .from("supplier_orders")
      .insert({ organization_id: organizationId, job_id: String(job.id), supplier, subtotal_cents: subtotal, status: "draft" })
      .select("id")
      .maybeSingle();
    if (error || !order) return { isError: true, text: "The supplier order could not be prepared." };

    const orderId = String(order.id);
    const { error: itemError } = await database.from("supplier_order_items").insert(
      rows.map((row) => ({
        order_id: orderId,
        organization_id: organizationId,
        material_name: text(row.material_name) || text(row.product_name),
        retailer_sku: text(row.retailer_sku) || null,
        product_name: text(row.product_name),
        product_url: text(row.product_url) || null,
        quantity: Number(row.quantity ?? 1),
        unit_price_cents: Number(row.unit_price_cents ?? 0),
        availability: text(row.availability) || null,
        store_name: text(row.store_name) || null,
        store_number: text(row.store_number) || null,
      })),
    );
    if (itemError) {
      await database.from("supplier_orders").delete().eq("id", orderId);
      return { isError: true, text: "The supplier order items could not be saved." };
    }

    return {
      text: `Supplier order ${orderId} prepared for job #${jobNumber}: ${rows.length} line items, ${formatMoney(subtotal / 100)} subtotal. Nothing has been purchased. Review it, then use submit_supplier_order only after owner approval.`,
    };
  }

  if (name === "list_supplier_orders") {
    const status = text(args.status) || "all";
    let query = database
      .from("supplier_orders")
      .select("id,supplier,status,subtotal_cents,external_order_id,checkout_url,created_at,jobs(job_number)")
      .eq("organization_id", organizationId)
      .order("created_at", { ascending: false })
      .limit(25);
    if (status !== "all") query = query.eq("status", status);
    const { data } = await query;
    const rows = (data ?? []) as Record<string, unknown>[];
    if (!rows.length) return { text: "No supplier orders match that status." };
    return {
      text: rows.map((row) => {
        const job = (row.jobs ?? {}) as Record<string, unknown>;
        return `${row.id} | ${text(row.supplier)} | job #${job.job_number ?? "?"} | ${text(row.status)} | ${formatMoney(Number(row.subtotal_cents ?? 0) / 100)}${row.external_order_id ? ` | retailer order ${row.external_order_id}` : ""}`;
      }).join("\n"),
    };
  }

  if (name === "submit_supplier_order") {
    const orderId = text(args.order_id);
    const gate = confirmation(args, `Approve and submit supplier order ${orderId}.`);
    if (gate) return gate;
    const { data: order } = await database
      .from("supplier_orders")
      .select("id,supplier,status")
      .eq("id", orderId)
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (!order) return { isError: true, text: "That supplier order was not found." };
    if (order.status === "ordered") return { text: `Order ${orderId} is already marked ordered. Nothing was submitted twice.` };

    await database
      .from("supplier_orders")
      .update({ status: "approved", approved_at: new Date().toISOString(), failure_reason: null })
      .eq("id", orderId);

    const result = await checkoutPreparedOrder({ supplier: text(order.supplier), orderId });
    if (!result.ok) {
      await database.from("supplier_orders").update({ failure_reason: result.reason ?? "Checkout unavailable" }).eq("id", orderId);
      return { isError: true, text: result.reason ?? "Checkout is not available. The order remains approved and unpurchased." };
    }

    await database
      .from("supplier_orders")
      .update({ status: "ordered", submitted_at: new Date().toISOString(), external_order_id: result.orderId, checkout_url: result.checkoutUrl, failure_reason: null })
      .eq("id", orderId);
    return { text: `Supplier order placed successfully${result.orderId ? ` as ${result.orderId}` : ""}.` };
  }

  return { isError: true, text: `Unknown supplier order tool: ${name}` };
}
