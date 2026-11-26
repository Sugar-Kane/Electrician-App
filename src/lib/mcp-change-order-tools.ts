/**
 * Change orders and invoice discounts, from ChatGPT or Claude.
 *
 * The same server functions the job page uses do the work (passed in as
 * `services`, so these rules are tested without a database): the same totals,
 * the same refusals, the same customer signature before anything the customer
 * owes moves. Nothing here can approve a change order — only the customer's
 * signature does — and nothing texts or emails a customer: putting a change
 * order in front of them writes the document, and the existing
 * send_contract_for_signature tool texts it, with the owner's say-so.
 *
 * Prices and discounts need the business's billing permission, checked here
 * against the person who connected the assistant and again in the database.
 * Writes that a retried request could repeat carry a request key — the
 * caller's, or one made from the request itself — so the same request twice
 * adds one item.
 */

import { createHash } from "node:crypto";

import { STATUS_LABELS, signedCents, type ChangeOrderStatus } from "./change-order-math.ts";
import { formatCents, formatQuantity } from "./job-lines.ts";
import type { McpTool, ToolResult } from "./mcp-protocol.ts";
import type { ChangeOrderRecord, ItemInput, JobChangeOrders, Result } from "./change-orders-server.ts";
import type { DiscountResult, InvoiceSummary } from "./invoice-adjustments-server.ts";

export type ChangeOrderServices = {
  loadJob(jobNumber: string): Promise<JobChangeOrders | null>;
  loadOrder(changeOrderId: string): Promise<(ChangeOrderRecord & { jobId: string; jobNumber: string }) | null>;
  create(input: { jobNumber: string; description: string; reason?: string; contractId?: string }): Promise<
    Result<{ changeOrderId: string; number: number; jobNumber: string; swept: number }>
  >;
  addItem(changeOrderId: string, item: ItemInput): Promise<Result<{ itemId: string; duplicate: boolean }>>;
  update(changeOrderId: string, input: { description?: string; reason?: string }): Promise<Result>;
  removeItem(changeOrderId: string, itemId: string): Promise<Result>;
  requestApproval(changeOrderId: string): Promise<
    Result<{ contractId: string; netCents: number; revisedCents: number | null; jobNumber: string; pdfError: string }>
  >;
  findInvoice(input: { invoiceId?: string; invoiceNumber?: string; jobNumber?: string }): Promise<{ invoiceId: string } | { problem: string }>;
  invoiceSummary(invoiceId: string): Promise<InvoiceSummary | null>;
  setDiscount(invoiceId: string, input: { type: string; value: string; reason?: string }): Promise<DiscountResult>;
};

export type ChangeOrderToolContext = {
  /** The connected owner may change billing: set prices, discounts. */
  canEditBilling: boolean;
  services: ChangeOrderServices;
};

const str = (description: string) => ({ type: "string", description });
const num = (description: string) => ({ type: ["number", "string"], description });
const changeOrderId = str("The change order's id, from list_job_change_orders or create_change_order.");
const requestId = str(
  "Optional. Your own id for this exact request. The same request_id twice adds one item. Without it, an identical request on the same change order is treated as a retry and adds nothing new — to add more of something, change its quantity instead.",
);
const confirmed = {
  type: "boolean",
  description:
    "Set true only after the user explicitly approved this exact action in this conversation. Leave false first to get the proposal to show them. For anything that reaches a customer or moves money (texts, estimates, invoices, contracts, billing, payments, discounts, supplier orders, cancelling or telling a customer about a job), true does not run it: it is sent to the owner to approve in Volteira (Operations → AI approval inbox) and runs once they approve.",
};
const READ = { readOnlyHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;

export const CHANGE_ORDER_MCP_TOOLS: McpTool[] = [
  {
    name: "list_job_change_orders",
    title: "List a job's change orders",
    description:
      "Every change order on a job (number, description, status, amount, customer approval), the contract total including approved change orders only, and the job's items with their ids (use those ids with modify_change_order_item and remove_change_order_item). Use this for \"what is the total contract amount including approved change orders\".",
    inputSchema: {
      type: "object",
      properties: { job_number: str("The job number, like 32.") },
      required: ["job_number"],
      additionalProperties: false,
    },
    annotations: READ,
  },
  {
    name: "get_change_order",
    title: "Get a change order",
    description: "One change order in full: what it adds (materials, labor), changes and removes, with the line each change touches as it was, the money, and its approval status.",
    inputSchema: { type: "object", properties: { change_order_id: changeOrderId }, required: ["change_order_id"], additionalProperties: false },
    annotations: READ,
  },
  {
    name: "create_change_order",
    title: "Create a draft change order",
    description:
      "Start a draft change order on a job that has a contract, when work is added, changed or removed. Nothing changes for the customer until they sign it. Items added to the job since the customer signed are included automatically. Then add items with add_change_order_material, add_change_order_labor, modify_change_order_item and remove_change_order_item. Ask the user for prices you do not know rather than guessing.",
    inputSchema: {
      type: "object",
      properties: {
        job_number: str("The job number."),
        contract_id: str("Optional. The contract's id, if you have it; the job's contract is used otherwise."),
        description: str("What is changing, in a sentence: \"Customer wants two more outlets in the garage\"."),
        reason: str("Optional. Why, e.g. \"Customer request\"."),
      },
      required: ["job_number", "description"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "add_change_order_material",
    title: "Add material to a change order",
    description:
      "Add a part to a draft change order: from the business's stock (material_id) or described (description). unit_price is the business's price each before any admin fee, which is added as on every job line. Leave unit_price out if the user has not said it; the item stays unpriced until it is. Adding a part never buys it.",
    inputSchema: {
      type: "object",
      properties: {
        change_order_id: changeOrderId,
        material_id: str("Optional. A stock item's id from the business's inventory."),
        description: str("What the part is, e.g. \"12/2 Romex\". Required unless material_id is given."),
        quantity: num("How many, or how much (e.g. 50 for 50 ft)."),
        unit: str("Optional unit: each, ft, box, roll, stick…"),
        unit_price: num("Optional. Price each, in dollars, e.g. 0.85."),
        unit_cost: num("Optional. What one cost the business, in dollars. Never shown to the customer."),
        notes: str("Optional."),
        request_id: requestId,
      },
      required: ["change_order_id", "quantity"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "add_change_order_labor",
    title: "Add labor to a change order",
    description:
      "Add labor to a draft change order: what the work is, the hours, and the hourly rate (the business's rate before any admin fee). Leave hourly_rate out if the user has not said it.",
    inputSchema: {
      type: "object",
      properties: {
        change_order_id: changeOrderId,
        description: str("The work, e.g. \"Additional troubleshooting\"."),
        hours: num("Hours, e.g. 2 or 1.5."),
        hourly_rate: num("Optional. Dollars per hour, e.g. 125."),
        notes: str("Optional."),
        request_id: requestId,
      },
      required: ["change_order_id", "description", "hours"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "modify_change_order_item",
    title: "Change an item on the contract",
    description:
      "Record a change to an item already on the job (from list_job_change_orders' items) in a draft change order: a new quantity, a new price each, or both. Only the difference is charged. The original item is kept as it was.",
    inputSchema: {
      type: "object",
      properties: {
        change_order_id: changeOrderId,
        original_contract_item_id: str("The job item's id."),
        quantity: num("Optional. The new quantity."),
        unit_price: num("Optional. The new price each, in dollars, before any admin fee."),
        description: str("Optional. A new description, e.g. a different fixture."),
        reason: str("Optional. Why."),
        request_id: requestId,
      },
      required: ["change_order_id", "original_contract_item_id"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "remove_change_order_item",
    title: "Remove an item from the contract",
    description:
      "Record that an item on the job (from list_job_change_orders' items) comes out, in a draft change order. Takes its value off the contract once the customer approves. The original item stays on record.",
    inputSchema: {
      type: "object",
      properties: {
        change_order_id: changeOrderId,
        original_contract_item_id: str("The job item's id."),
        reason: str("Optional. Why."),
        request_id: requestId,
      },
      required: ["change_order_id", "original_contract_item_id"],
      additionalProperties: false,
    },
    annotations: WRITE,
  },
  {
    name: "update_change_order",
    title: "Update a draft change order",
    description: "Change a draft's description or reason, or take items off it (remove_item_ids, from get_change_order). Only drafts can change: one the customer has been asked to sign must be withdrawn in Volteira first.",
    inputSchema: {
      type: "object",
      properties: {
        change_order_id: changeOrderId,
        description: str("Optional. New description."),
        reason: str("Optional. New reason."),
        remove_item_ids: { type: "array", items: { type: "string" }, description: "Optional. Items to take off this draft." },
      },
      required: ["change_order_id"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "get_change_order_summary",
    title: "Change order money",
    description: "The financial summary of one change order: contract before it, added materials, added labor, changed work, removed work, the net change, the revised contract total, and its approval status.",
    inputSchema: { type: "object", properties: { change_order_id: changeOrderId }, required: ["change_order_id"], additionalProperties: false },
    annotations: READ,
  },
  {
    name: "request_change_order_approval",
    title: "Prepare a change order for the customer to sign",
    description:
      "Write the change order document for the customer to approve and sign. This does not approve it, and does not message the customer: afterwards, use send_contract_for_signature for the job to text them the signing link, or they can sign in person. Only for a signed contract (an unsigned one is updated in Volteira instead). Call once without confirmed to get the proposal, then again with confirmed true only if the user says yes.",
    inputSchema: {
      type: "object",
      properties: { change_order_id: changeOrderId, confirmed },
      required: ["change_order_id", "confirmed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  },
  {
    name: "set_invoice_discount",
    title: "Set or remove an invoice discount",
    description:
      "Give an invoice a percentage or fixed-dollar discount, replace the one it has (they never stack), or remove it with discount_type none. Recounts the invoice. Not for a paid or void invoice. Find the invoice by invoice_number or job_number. Call once without confirmed to get the proposal, then again with confirmed true only if the user says yes.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: str("Optional. The invoice's id."),
        invoice_number: str("Invoice number, with or without INV-. Or give job_number."),
        job_number: str("The job number, if the invoice number is not known."),
        discount_type: { type: "string", enum: ["percentage", "fixed", "none"] },
        discount_value: num("For percentage: 0–100 (10 means 10%). For fixed: dollars, e.g. 100. Ignored for none."),
        reason: str("Optional, e.g. \"Customer loyalty discount\"."),
        confirmed,
      },
      required: ["discount_type", "confirmed"],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: "get_invoice_summary",
    title: "Invoice summary",
    description:
      "An invoice's figures as the customer sees them: original work, each approved change order, subtotal, discount (only if there is one), diagnostic credit, tax, total, payments received, balance due and status.",
    inputSchema: {
      type: "object",
      properties: {
        invoice_id: str("Optional. The invoice's id."),
        invoice_number: str("Invoice number, with or without INV-. Or give job_number."),
        job_number: str("The job number, if the invoice number is not known."),
      },
      additionalProperties: false,
    },
    annotations: READ,
  },
];

const NAMES = new Set(CHANGE_ORDER_MCP_TOOLS.map((tool) => tool.name));
export function isChangeOrderTool(name: string): boolean {
  return NAMES.has(name);
}

type Args = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(message: string, code: string): ToolResult {
  return { isError: true, text: message, structured: { ok: false, error: code, message } };
}

const signed = (cents: number) => signedCents(cents, formatCents);

/**
 * The key a retried request is recognised by: the caller's own id, or the
 * request itself — the tool, the change order and every argument, in a fixed
 * order — so ChatGPT repeating a call adds nothing the second time.
 */
export function requestKey(tool: string, args: Args): string {
  const own = text(args.request_id);
  if (own) return `id:${own.slice(0, 100)}`;
  const parts = Object.keys(args)
    .filter((key) => key !== "request_id" && key !== "confirmed")
    .sort()
    .map((key) => `${key}=${JSON.stringify(args[key])}`);
  return `auto:${createHash("sha256").update(`${tool}|${parts.join("&")}`).digest("hex").slice(0, 40)}`;
}

/** A money figure as the model sends it ("125", 125, "$1,250.00") as the text the server reads. */
function priceText(value: unknown): string {
  return text(value).replace(/^\$/, "");
}

function orderJson(order: ChangeOrderRecord) {
  return {
    change_order_id: order.id,
    number: order.number,
    description: order.description,
    reason: order.reason,
    status: order.status,
    status_label: order.statusLabel,
    amount_cents: order.netCents,
    approval_status:
      order.status === "approved"
        ? order.approvalMethod === "contract_revision"
          ? "included_in_revised_contract"
          : "approved_by_customer"
        : order.status === "pending_approval"
          ? "awaiting_customer_signature"
          : order.status === "rejected"
            ? "declined_by_customer"
            : order.status === "canceled"
              ? "withdrawn"
              : "not_requested",
    approved_by: order.approvedByName || null,
    approved_at: order.approvedAt,
    created_at: order.createdAt,
    applied_to_job: Boolean(order.appliedAt),
    credit_due_cents: order.creditDueCents,
  };
}

function summaryJson(order: ChangeOrderRecord, contractBefore: number | null) {
  return {
    ...orderJson(order),
    original_contract_cents: contractBefore,
    added_materials_cents: order.summary.addedMaterialsCents,
    added_labor_cents: order.summary.addedLaborCents,
    modified_work_cents: order.summary.modifiedCents,
    removed_work_cents: order.summary.removedCents,
    net_adjustment_cents: order.netCents,
    revised_contract_cents: contractBefore === null ? null : contractBefore + order.netCents,
    unpriced_items: order.summary.unpricedCount,
  };
}

function summaryText(order: ChangeOrderRecord, contractBefore: number | null): string {
  const lines = [`Change order #${order.number} — ${STATUS_LABELS[order.status as ChangeOrderStatus] ?? order.status}`];
  if (contractBefore !== null) lines.push(`Contract before: ${formatCents(contractBefore)}`);
  if (order.summary.addedMaterialsCents) lines.push(`Added materials: ${signed(order.summary.addedMaterialsCents)}`);
  if (order.summary.addedLaborCents) lines.push(`Added labor: ${signed(order.summary.addedLaborCents)}`);
  if (order.summary.modifiedCents) lines.push(`Changed work: ${signed(order.summary.modifiedCents)}`);
  if (order.summary.removedCents) lines.push(`Removed work: ${signed(order.summary.removedCents)}`);
  lines.push(`Net change order: ${signed(order.netCents)}`);
  if (contractBefore !== null) lines.push(`Revised contract total: ${formatCents(contractBefore + order.netCents)}`);
  if (order.summary.unpricedCount > 0) lines.push(`${order.summary.unpricedCount} item(s) still need a price before the customer can be asked.`);
  return lines.join("\n");
}

function itemsText(order: ChangeOrderRecord): string {
  if (order.items.length === 0) return "No items yet.";
  return order.items
    .map((item) => {
      const amount = item.action !== "remove" && item.unitPriceCents === null ? "needs a price" : signed(item.netCents);
      if (item.action === "remove") return `- Remove: ${item.original?.description ?? item.description} (${amount}) [item ${item.id}]`;
      if (item.action === "modify") {
        return `- Change: ${item.original?.description ?? ""} ${formatQuantity(item.original?.quantity ?? 0)} → ${item.description} ${formatQuantity(item.quantity)} (${amount}) [item ${item.id}]`;
      }
      return `- Add ${item.kind}: ${item.description}, ${formatQuantity(item.quantity)} ${item.unit} (${amount}) [item ${item.id}]`;
    })
    .join("\n");
}

/** The order, its job's contract total before it, or a refusal. */
async function withOrder(context: ChangeOrderToolContext, args: Args) {
  const id = text(args.change_order_id);
  if (!UUID.test(id)) return { problem: error("That change order id could not be read. Get it from list_job_change_orders.", "invalid_change_order_id") };
  const order = await context.services.loadOrder(id);
  if (!order) return { problem: error("That change order was not found in this business.", "not_found") };
  const job = await context.services.loadJob(order.jobNumber);
  const contractBefore = order.status === "draft" ? job?.totals.committedCents ?? null : order.originalContractCents;
  return { order, job, contractBefore };
}

async function addItem(context: ChangeOrderToolContext, tool: string, args: Args, item: ItemInput): Promise<ToolResult> {
  if (!context.canEditBilling && item.unitPrice) {
    return error("Billing changes are turned off for the person who connected the assistant, so prices cannot be set from here. Leave the price out.", "forbidden_price");
  }
  const found = await withOrder(context, args);
  if ("problem" in found) return found.problem!;
  const added = await context.services.addItem(found.order.id, { ...item, requestKey: requestKey(tool, args) });
  if (!added.ok) return error(added.error, "refused");
  const fresh = (await context.services.loadOrder(found.order.id)) ?? found.order;
  return {
    text: `${added.duplicate ? "Already on the change order (this request was seen before); nothing was added twice." : "Added."}\n${summaryText(fresh, found.contractBefore)}`,
    structured: { ok: true, item_id: added.itemId, duplicate: added.duplicate, summary: summaryJson(fresh, found.contractBefore) },
  };
}

export async function runChangeOrderTool(input: { name: string; args: Args; context: ChangeOrderToolContext }): Promise<ToolResult> {
  const { name, args, context } = input;
  const services = context.services;

  switch (name) {
    case "list_job_change_orders": {
      const jobNumber = text(args.job_number).replace(/^#/, "");
      if (!/^\d+$/.test(jobNumber)) return error("Give the job number, like 32.", "invalid_job_number");
      const job = await services.loadJob(jobNumber);
      if (!job) return error(`Job #${jobNumber} was not found.`, "not_found");
      const totals = job.totals;
      const lines = [
        job.agreement
          ? `Contract: ${job.agreement.signed ? "signed" : "not signed yet"}${totals.originalCents !== null ? `, ${formatCents(totals.originalCents)}` : ""}.`
          : "This job has no contract yet.",
        ...totals.approved.map((order) => `Approved change order #${order.number}: ${signed(order.netCents)}`),
        totals.committedCents !== null ? `Contract total including approved change orders: ${formatCents(totals.committedCents)}.` : "",
        totals.pendingNetCents ? `Waiting for the customer (not counted): ${signed(totals.pendingNetCents)}.` : "",
        "",
        job.changeOrders.length
          ? job.changeOrders.map((order) => `#${order.number} ${order.statusLabel}: ${order.description} (${signed(order.netCents)}) [id ${order.id}]`).join("\n")
          : "No change orders.",
        "",
        "Items on the job:",
        ...job.lines.map((line) => `- ${line.description}, ${formatQuantity(line.quantity)} ${line.unit} at ${formatCents(line.unitPriceCents)} [id ${line.id}]`),
      ].filter((line, index, all) => line !== "" || all[index - 1] !== "");
      return {
        text: lines.join("\n"),
        structured: {
          ok: true,
          job_number: job.jobNumber,
          contract: job.agreement
            ? { contract_id: job.agreement.id, signed: job.agreement.signed, original_contract_cents: totals.originalCents }
            : null,
          approved_change_orders_cents: totals.approvedNetCents,
          pending_change_orders_cents: totals.pendingNetCents,
          contract_total_cents: totals.committedCents,
          change_orders: job.changeOrders.map(orderJson),
          contract_items: job.lines.map((line) => ({
            id: line.id,
            kind: line.kind,
            description: line.description,
            quantity: line.quantity,
            unit: line.unit,
            unit_price_cents: line.unitPriceCents,
            billed_note: line.billedNote || null,
          })),
        },
      };
    }

    case "get_change_order": {
      const found = await withOrder(context, args);
      if ("problem" in found) return found.problem!;
      const { order, contractBefore } = found;
      return {
        text: `${summaryText(order, contractBefore)}\n\n${order.description}${order.reason ? `\nWhy: ${order.reason}` : ""}\n\n${itemsText(order)}`,
        structured: {
          ok: true,
          ...summaryJson(order, contractBefore),
          job_number: order.jobNumber,
          items: order.items.map((item) => ({
            item_id: item.id,
            action: item.action,
            kind: item.kind,
            description: item.description,
            quantity: item.quantity,
            unit: item.unit,
            unit_price_cents: item.unitPriceCents,
            net_cents: item.netCents,
            original_contract_item_id: item.lineId,
            original: item.original
              ? { description: item.original.description, quantity: item.original.quantity, unit: item.original.unit, unit_price_cents: item.original.unitPriceCents }
              : null,
            already_on_job: Boolean(item.existingLine),
          })),
        },
      };
    }

    case "create_change_order": {
      const jobNumber = text(args.job_number).replace(/^#/, "");
      if (!/^\d+$/.test(jobNumber)) return error("Give the job number, like 32.", "invalid_job_number");
      const description = text(args.description);
      if (!description) return error("Say what is changing.", "missing_description");
      const contractId = text(args.contract_id);
      if (contractId && !UUID.test(contractId)) return error("That contract id could not be read. Leave it out to use the job's contract.", "invalid_contract_id");
      const created = await services.create({ jobNumber, description, reason: text(args.reason) || undefined, contractId: contractId || undefined });
      if (!created.ok) return error(created.error, "refused");
      return {
        text: `Draft change order #${created.number} started on job #${created.jobNumber} (id ${created.changeOrderId}).${created.swept ? ` ${created.swept} item(s) added since the customer signed are included.` : ""} Add the changes next. Nothing changes for the customer until they sign it.`,
        structured: { ok: true, change_order_id: created.changeOrderId, number: created.number, job_number: created.jobNumber, status: "draft", included_unsigned_additions: created.swept },
      };
    }

    case "add_change_order_material": {
      const materialId = text(args.material_id);
      if (materialId && !UUID.test(materialId)) return error("That material id could not be read.", "invalid_material_id");
      if (!materialId && !text(args.description)) return error("Say what the part is, or give a material_id from stock.", "missing_description");
      if (!text(args.quantity)) return error("Give the quantity.", "missing_quantity");
      return addItem(context, name, args, {
        action: "add",
        kind: "material",
        description: text(args.description) || undefined,
        quantity: text(args.quantity),
        unit: text(args.unit) || undefined,
        unitPrice: priceText(args.unit_price),
        unitCost: priceText(args.unit_cost),
        inventoryItemId: materialId || undefined,
        notes: text(args.notes) || undefined,
      });
    }

    case "add_change_order_labor": {
      if (!text(args.description)) return error("Say what the work is.", "missing_description");
      if (!text(args.hours)) return error("Give the hours.", "missing_hours");
      return addItem(context, name, args, {
        action: "add",
        kind: "labor",
        description: text(args.description),
        quantity: text(args.hours),
        unitPrice: priceText(args.hourly_rate),
        notes: text(args.notes) || undefined,
      });
    }

    case "modify_change_order_item": {
      const lineId = text(args.original_contract_item_id);
      if (!UUID.test(lineId)) return error("Give the job item's id from list_job_change_orders.", "invalid_item_id");
      if (!text(args.quantity) && !text(args.unit_price) && !text(args.description)) {
        return error("Say what changes: a new quantity, a new price, or a new description.", "nothing_to_change");
      }
      return addItem(context, name, args, {
        action: "modify",
        lineId,
        quantity: text(args.quantity) || undefined,
        unitPrice: priceText(args.unit_price),
        description: text(args.description) || undefined,
        notes: text(args.reason) || undefined,
      });
    }

    case "remove_change_order_item": {
      const lineId = text(args.original_contract_item_id);
      if (!UUID.test(lineId)) return error("Give the job item's id from list_job_change_orders.", "invalid_item_id");
      return addItem(context, name, args, { action: "remove", lineId, notes: text(args.reason) || undefined });
    }

    case "update_change_order": {
      const found = await withOrder(context, args);
      if ("problem" in found) return found.problem!;
      if (found.order.status !== "draft") {
        return error(`Change order #${found.order.number} is ${found.order.statusLabel.toLowerCase()} and can no longer be edited.`, "not_editable");
      }
      const removing = Array.isArray(args.remove_item_ids) ? args.remove_item_ids.map(text).filter(Boolean) : [];
      if (removing.some((id) => !UUID.test(id) || !found.order.items.some((item) => item.id === id))) {
        return error("One of those item ids is not on this change order.", "invalid_item_id");
      }
      if (typeof args.description === "string" || typeof args.reason === "string") {
        const updated = await services.update(found.order.id, {
          description: typeof args.description === "string" ? args.description : undefined,
          reason: typeof args.reason === "string" ? args.reason : undefined,
        });
        if (!updated.ok) return error(updated.error, "refused");
      }
      for (const itemId of removing) {
        const removed = await services.removeItem(found.order.id, itemId);
        if (!removed.ok) return error(removed.error, "refused");
      }
      const fresh = (await services.loadOrder(found.order.id)) ?? found.order;
      return { text: `Saved.\n${summaryText(fresh, found.contractBefore)}`, structured: { ok: true, summary: summaryJson(fresh, found.contractBefore) } };
    }

    case "get_change_order_summary": {
      const found = await withOrder(context, args);
      if ("problem" in found) return found.problem!;
      return { text: summaryText(found.order, found.contractBefore), structured: { ok: true, ...summaryJson(found.order, found.contractBefore) } };
    }

    case "request_change_order_approval": {
      if (!context.canEditBilling) return error("Billing changes are turned off for the person who connected the assistant.", "forbidden");
      const found = await withOrder(context, args);
      if ("problem" in found) return found.problem!;
      const { order, job, contractBefore } = found;
      if (order.status !== "draft") return error(`Change order #${order.number} is ${order.statusLabel.toLowerCase()}, not a draft.`, "not_draft");
      if (job && job.agreement && !job.agreement.signed) {
        return error("The customer has not signed the contract yet. Update the contract with these changes in Volteira instead, so they sign one document.", "contract_unsigned");
      }
      if (args.confirmed !== true) {
        return {
          text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: prepare change order #${order.number} on job #${order.jobNumber} for the customer to sign — ${signed(order.summary.netCents)}${contractBefore !== null ? `, bringing the contract to ${formatCents(contractBefore + order.summary.netCents)}` : ""}. It is not approved until the customer signs, and no message is sent.`,
          structured: { ok: true, proposal: true, change_order_id: order.id, net_adjustment_cents: order.summary.netCents },
        };
      }
      const requested = await services.requestApproval(order.id);
      if (!requested.ok) return error(requested.error, "refused");
      return {
        text: `Change order #${order.number} is ready for the customer to sign (${signed(requested.netCents)}${requested.revisedCents !== null ? `; contract total once approved: ${formatCents(requested.revisedCents)}` : ""}). It is NOT approved yet. To text them the signing link, use send_contract_for_signature for job #${requested.jobNumber} (with the owner's approval), or they can sign in person in Volteira.`,
        structured: {
          ok: true,
          change_order_id: order.id,
          status: "pending_approval",
          contract_id: requested.contractId,
          net_adjustment_cents: requested.netCents,
          revised_contract_cents: requested.revisedCents,
          next_step: "send_contract_for_signature",
        },
      };
    }

    case "set_invoice_discount": {
      if (!context.canEditBilling) return error("Billing changes are turned off for the person who connected the assistant, so discounts cannot be set from here.", "forbidden");
      const type = text(args.discount_type);
      if (!["percentage", "fixed", "none"].includes(type)) return error("discount_type is percentage, fixed or none.", "invalid_discount_type");
      if (type !== "none" && !text(args.discount_value)) return error("Give discount_value: a percentage like 10, or dollars like 100.", "missing_discount_value");
      const invoiceRef = await services.findInvoice({
        invoiceId: text(args.invoice_id) || undefined,
        invoiceNumber: text(args.invoice_number) || undefined,
        jobNumber: text(args.job_number) || undefined,
      });
      if ("problem" in invoiceRef) return error(invoiceRef.problem, "not_found");
      const current = await services.invoiceSummary(invoiceRef.invoiceId);
      if (!current) return error("That invoice was not found.", "not_found");
      const value = type === "none" ? "" : priceText(args.discount_value);
      if (args.confirmed !== true) {
        const what =
          type === "none"
            ? current.discountCents > 0
              ? `remove the ${current.discountLabel.toLowerCase()} from INV-${current.invoiceNumber}`
              : `INV-${current.invoiceNumber} has no discount to remove`
            : `${current.discountCents > 0 ? `replace the ${current.discountLabel.toLowerCase()} on` : "give"} INV-${current.invoiceNumber} ${type === "percentage" ? `a ${value}% discount` : `a $${value} discount`}${current.discountCents > 0 ? " instead (discounts never stack)" : ""}`;
        return {
          text: `CONFIRMATION REQUIRED. Nothing was changed. Proposed action: ${what}. The subtotal is ${formatCents(current.subtotalCents)}; the total now is ${formatCents(current.totalCents)}.`,
          structured: { ok: true, proposal: true, invoice_number: current.invoiceNumber, discount_type: type, discount_value: value || null },
        };
      }
      const result = await services.setDiscount(invoiceRef.invoiceId, { type, value, reason: text(args.reason) || undefined });
      if (!result.ok) return error(result.error, "refused");
      return { text: result.message, structured: { ok: true, revised: result.revised, invoice: invoiceJson(result.summary) } };
    }

    case "get_invoice_summary": {
      const invoiceRef = await services.findInvoice({
        invoiceId: text(args.invoice_id) || undefined,
        invoiceNumber: text(args.invoice_number) || undefined,
        jobNumber: text(args.job_number) || undefined,
      });
      if ("problem" in invoiceRef) return error(invoiceRef.problem, "not_found");
      const summary = await services.invoiceSummary(invoiceRef.invoiceId);
      if (!summary) return error("That invoice was not found.", "not_found");
      return { text: invoiceText(summary), structured: { ok: true, invoice: invoiceJson(summary) } };
    }
  }

  return error(`Unknown tool: ${name}`, "unknown_tool");
}

export function invoiceJson(summary: InvoiceSummary) {
  return {
    invoice_id: summary.invoiceId,
    invoice_number: summary.invoiceNumber,
    job_number: summary.jobNumber,
    status: summary.status,
    original_subtotal_cents: summary.originalSubtotalCents,
    change_orders: summary.changeOrders.map((entry) => ({ number: entry.number, amount_cents: entry.amountCents })),
    approved_change_order_cents: summary.changeOrderCents,
    subtotal_cents: summary.subtotalCents,
    // Only when there is one: no discount is null, never a zero discount.
    discount:
      summary.discountCents > 0 && summary.discount
        ? {
            type: summary.discount.type,
            value: summary.discount.type === "percentage" ? summary.discount.basisPoints / 100 : summary.discount.cents / 100,
            amount_cents: summary.discountCents,
            label: summary.discountLabel,
            reason: summary.discountReason || null,
            capped: summary.discountCapped,
          }
        : null,
    diagnostic_credit_cents: summary.diagnosticCreditCents,
    tax_cents: summary.taxCents,
    total_cents: summary.totalCents,
    payments_received_cents: summary.paidCents,
    balance_due_cents: summary.balanceDueCents,
    revision_number: summary.revisionNumber,
    changed_since_sent: summary.changedSinceSent,
  };
}

export function invoiceText(summary: InvoiceSummary): string {
  const lines = [`INV-${summary.invoiceNumber} (${summary.status})`];
  if (summary.changeOrders.length > 0) {
    lines.push(`Original work: ${formatCents(summary.originalSubtotalCents)}`);
    for (const entry of summary.changeOrders) lines.push(`Change order #${entry.number}: ${signed(entry.amountCents)}`);
  }
  lines.push(`Subtotal: ${formatCents(summary.subtotalCents)}`);
  if (summary.discountCents > 0) lines.push(`${summary.discountLabel}: -${formatCents(summary.discountCents)}`);
  if (summary.diagnosticCreditCents > 0) lines.push(`Diagnostic fee already paid: -${formatCents(summary.diagnosticCreditCents)}`);
  lines.push(`Tax: ${formatCents(summary.taxCents)}`);
  lines.push(`Total: ${formatCents(summary.totalCents)}`);
  if (summary.paidCents > 0) lines.push(`Payments received: ${formatCents(summary.paidCents)}`);
  lines.push(`Balance due: ${formatCents(summary.balanceDueCents)}`);
  if (summary.changedSinceSent) lines.push("The customer's copy is out of date: send it again so they have these figures.");
  return lines.join("\n");
}
