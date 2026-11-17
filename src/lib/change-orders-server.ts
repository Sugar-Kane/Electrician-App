import "server-only";

import { randomUUID } from "node:crypto";

import { recordActivity } from "@/lib/activity";
import { adminFeeOn } from "@/lib/admin-fee";
import { planChangeOrder, type PlanInvoice, type PlanItem, type PlanLine } from "@/lib/change-order-apply";
import { changeOrderDocument } from "@/lib/change-order-document";
import {
  CHANGE_ORDER_STATUSES,
  STATUS_LABELS,
  canEditChangeOrder,
  changeOrderSummary,
  contractTotals,
  itemNetCents,
  itemsNotReadyBecause,
  lineMatchesOriginal,
  type ChangeOrderAction,
  type ChangeOrderItem,
  type ChangeOrderKind,
  type ChangeOrderStatus,
  type ChangeOrderSummary,
  type ContractTotals,
} from "@/lib/change-order-math";
import { serviceAddress } from "@/lib/contract-template";
import { billingParty } from "@/lib/customer-details";
import { diagnosticCreditLeft } from "@/lib/diagnostic-credit";
import { agreementChanges, type ContractStanding } from "@/lib/job-billing";
import { jobInvoices, rebuildInvoiceDocument, type BilledJob } from "@/lib/job-billing-server";
import { formatCents, parseQuantity, readPrice } from "@/lib/job-lines";
import type { FlexibleSupabaseClient } from "@/lib/supabase/flexible";

/**
 * Change orders, against the database.
 *
 * The rules — what a change is worth, what may be edited, where an approved one
 * lands — live in change-order-math.ts and change-order-apply.ts and are tested
 * there. This is what the job page, the customer's signing page and ChatGPT
 * share, so all three create, price, send and apply a change order the same
 * way and report the same totals.
 *
 * Reads and edits go through whichever client the caller passes: the person's
 * own session on the job page, so row-level security decides whose change
 * order it is; the service role for ChatGPT and the customer's signature, with
 * every query scoped to the business explicitly. Applying always uses the
 * service role, because `apply_change_order` is not callable by anybody else.
 */

type Row = Record<string, unknown>;

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function num(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : 0;
}

function maybeNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = num(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string };

/** Who is asking, and whether they may set prices (the business's billing permission). */
export type ChangeOrderActor = { userId: string | null; canSetPrices: boolean };

export type ChangeOrderItemRecord = ChangeOrderItem & {
  adminFeeCents: number | null;
  unitCostCents: number | null;
  inventoryItemId: string | null;
  netCents: number;
  appliedEffect: string | null;
  billedInvoiceId: string | null;
};

export type ResendRecord = {
  revisionId: string;
  invoiceId: string;
  invoiceNumber: string;
  status: "pending" | "sending" | "sent" | "failed";
  detail: string;
};

export type ChangeOrderRecord = {
  id: string;
  number: number;
  description: string;
  reason: string;
  status: ChangeOrderStatus;
  statusLabel: string;
  approvalMethod: "customer_signature" | "contract_revision" | null;
  /** What it adds or takes off: worked out live for a draft, as the customer was asked once sent. */
  netCents: number;
  originalContractCents: number | null;
  baseContractId: string | null;
  documentContractId: string | null;
  createdAt: string;
  requestedAt: string | null;
  approvedAt: string | null;
  approvedByName: string;
  rejectedAt: string | null;
  rejectionReason: string;
  canceledAt: string | null;
  appliedAt: string | null;
  creditDueCents: number;
  version: number;
  items: ChangeOrderItemRecord[];
  summary: ChangeOrderSummary;
  /** Updated invoices this change order is sending, or failed to send. */
  resends: ResendRecord[];
};

export type JobLineChoice = {
  id: string;
  kind: ChangeOrderKind;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  adminFeeCents: number | null;
  invoiceId: string | null;
  /** What changing it would do, when it is already billed: "Billed on INV-32 (paid)". Empty when unbilled. */
  billedNote: string;
};

export type JobChangeOrders = {
  jobId: string;
  jobNumber: string;
  adminFeeBps: number;
  agreement: { id: string; status: string; signed: boolean; signedAt: string | null; totalCents: number | null } | null;
  totals: ContractTotals;
  changeOrders: ChangeOrderRecord[];
  /** The job's lines, for choosing what to change or take out. */
  lines: JobLineChoice[];
  /** Customer rates already used for labor on this job, for one-tap reuse. */
  laborRates: number[];
};

const ORDER_COLUMNS = `id, number, description, reason, status, approval_method, net_cents, original_contract_cents,
  base_contract_id, document_contract_id, created_at, requested_at, approved_at, approved_by_name, rejected_at,
  rejection_reason, canceled_at, applied_at, credit_due_cents, version,
  change_order_items ( id, action, kind, description, quantity, unit, unit_price_cents, admin_fee_cents, unit_cost_cents,
    inventory_item_id, notes, line_id, existing_line, original_description, original_quantity, original_unit,
    original_unit_price_cents, net_cents, applied_effect, billed_invoice_id, created_at )`;

function mapItem(row: Row): ChangeOrderItemRecord {
  const hasOriginal = row.original_quantity !== null && row.original_quantity !== undefined;
  const item: ChangeOrderItemRecord = {
    id: text(row.id),
    action: (["add", "modify", "remove"].includes(text(row.action)) ? text(row.action) : "add") as ChangeOrderAction,
    kind: text(row.kind) === "labor" ? "labor" : "material",
    description: text(row.description),
    quantity: num(row.quantity),
    unit: text(row.unit) || "each",
    unitPriceCents: maybeNum(row.unit_price_cents),
    lineId: text(row.line_id) || null,
    original: hasOriginal
      ? {
          description: text(row.original_description),
          quantity: num(row.original_quantity),
          unit: text(row.original_unit) || "each",
          unitPriceCents: num(row.original_unit_price_cents),
        }
      : null,
    existingLine: row.existing_line === true,
    notes: text(row.notes),
    adminFeeCents: maybeNum(row.admin_fee_cents),
    unitCostCents: maybeNum(row.unit_cost_cents),
    inventoryItemId: text(row.inventory_item_id) || null,
    netCents: num(row.net_cents),
    appliedEffect: text(row.applied_effect) || null,
    billedInvoiceId: text(row.billed_invoice_id) || null,
  };
  return item;
}

function mapOrder(row: Row, resends: ResendRecord[]): ChangeOrderRecord {
  // In the order they were written.
  const items = (Array.isArray(row.change_order_items) ? (row.change_order_items as Row[]) : [])
    .slice()
    .sort((a, b) => text(a.created_at).localeCompare(text(b.created_at)) || text(a.id).localeCompare(text(b.id)))
    .map(mapItem);

  const status = (CHANGE_ORDER_STATUSES as readonly string[]).includes(text(row.status))
    ? (text(row.status) as ChangeOrderStatus)
    : "draft";
  const summary = changeOrderSummary(items);
  return {
    id: text(row.id),
    number: num(row.number),
    description: text(row.description),
    reason: text(row.reason),
    status,
    statusLabel: STATUS_LABELS[status],
    approvalMethod:
      row.approval_method === "customer_signature" || row.approval_method === "contract_revision"
        ? row.approval_method
        : null,
    netCents: status === "draft" ? summary.netCents : num(row.net_cents),
    originalContractCents: maybeNum(row.original_contract_cents),
    baseContractId: text(row.base_contract_id) || null,
    documentContractId: text(row.document_contract_id) || null,
    createdAt: text(row.created_at),
    requestedAt: text(row.requested_at) || null,
    approvedAt: text(row.approved_at) || null,
    approvedByName: text(row.approved_by_name),
    rejectedAt: text(row.rejected_at) || null,
    rejectionReason: text(row.rejection_reason),
    canceledAt: text(row.canceled_at) || null,
    appliedAt: text(row.applied_at) || null,
    creditDueCents: num(row.credit_due_cents),
    version: num(row.version) || 1,
    items,
    summary,
    resends,
  };
}

/** The job, by number or id, in this business. */
async function findJob(
  database: FlexibleSupabaseClient,
  organizationId: string,
  job: { jobNumber?: string | number; jobId?: string },
): Promise<Row | null> {
  let query = database
    .from("jobs")
    .select(
      `id, job_number, admin_fee_bps, diagnostic_paid, diagnostic_fee_cents, follow_up_of,
       customers ( id, first_name, last_name, company_name, bill_to, phone, email, address_line_1, city, state, postal_code ),
       properties ( address_line_1, city, state, postal_code ),
       organizations ( name, phone, timezone )`,
    )
    .eq("organization_id", organizationId);
  if (job.jobId) query = query.eq("id", job.jobId);
  else {
    const number = Number(String(job.jobNumber ?? "").replace(/^#/, ""));
    if (!Number.isInteger(number)) return null;
    query = query.eq("job_number", number);
  }
  const { data } = await query.maybeSingle();
  return (data ?? null) as Row | null;
}

/** The agreement change orders on this job amend: the newest signed one, else the newest that is not void. */
function currentAgreement(contracts: Row[]): Row | null {
  const agreements = contracts
    .filter((contract) => text(contract.kind) !== "change_order" && text(contract.status) !== "void")
    .sort((a, b) => text(b.created_at).localeCompare(text(a.created_at)));
  return agreements.find((contract) => Boolean(text(contract.signed_at))) ?? agreements[0] ?? null;
}

/**
 * What signed change orders from before structured change orders added: their
 * documents' own figures, for those against this agreement with no change
 * order record of their own.
 */
function legacyApprovedCents(contracts: Row[], orders: Row[], agreement: Row | null): number {
  if (!agreement) return 0;
  const documented = new Set(orders.map((order) => text(order.document_contract_id)).filter(Boolean));
  const after = text(agreement.created_at);
  return contracts
    .filter(
      (contract) =>
        text(contract.kind) === "change_order" &&
        Boolean(text(contract.signed_at)) &&
        !documented.has(text(contract.id)) &&
        text(contract.created_at) > after,
    )
    .reduce((sum, contract) => sum + num(contract.total_cents), 0);
}

function billedNote(invoiceId: string | null, invoices: Awaited<ReturnType<typeof jobInvoices>>): string {
  if (!invoiceId) return "";
  const invoice = invoices.find((entry) => entry.id === invoiceId);
  if (!invoice || invoice.status === "void") return "";
  if (invoice.status === "paid" || invoice.paidAt) return `Billed on INV-${invoice.number}, which is paid. Less work becomes a credit; more work goes on a new invoice.`;
  if (invoice.stripeInvoiceId) return `Billed on INV-${invoice.number}, collected through Stripe. Less work becomes a credit; more work goes on a new invoice.`;
  if (invoice.status === "draft" && !invoice.lastSentAt) return `On draft INV-${invoice.number}, which will be updated.`;
  return `Billed on INV-${invoice.number}, which will be revised and sent to the customer again once approved.`;
}

/** Everything the job page and ChatGPT show about a job's change orders, and the contract total. */
export async function loadJobChangeOrders(
  database: FlexibleSupabaseClient,
  organizationId: string,
  job: { jobNumber?: string | number; jobId?: string },
): Promise<JobChangeOrders | null> {
  const found = await findJob(database, organizationId, job);
  if (!found) return null;
  const jobId = text(found.id);

  const [{ data: contractRows }, { data: orderRows }, { data: lineRows }, invoices, { data: revisionRows }] = await Promise.all([
    database
      .from("contracts")
      .select("id, kind, status, created_at, signed_at, total_cents")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId),
    database
      .from("change_orders")
      .select(ORDER_COLUMNS)
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .order("number", { ascending: false }),
    database
      .from("job_line_items")
      .select("id, kind, description, quantity, unit, unit_price_cents, admin_fee_cents, invoice_id, created_at")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .order("created_at", { ascending: true }),
    jobInvoices(database, organizationId, jobId),
    database
      .from("invoice_revisions")
      .select("id, invoice_id, change_order_id, resend_status, resend_detail")
      .eq("organization_id", organizationId)
      .in("resend_status", ["pending", "sending", "sent", "failed"]),
  ]);

  const contracts = (contractRows ?? []) as Row[];
  const orders = (orderRows ?? []) as Row[];
  const agreement = currentAgreement(contracts);
  const numberOf = new Map(invoices.map((invoice) => [invoice.id, invoice.number]));
  const resendsByOrder = new Map<string, ResendRecord[]>();
  for (const revision of (revisionRows ?? []) as Row[]) {
    const orderId = text(revision.change_order_id);
    if (!orderId || !numberOf.has(text(revision.invoice_id))) continue;
    const list = resendsByOrder.get(orderId) ?? [];
    list.push({
      revisionId: text(revision.id),
      invoiceId: text(revision.invoice_id),
      invoiceNumber: numberOf.get(text(revision.invoice_id)) ?? "",
      status: text(revision.resend_status) as ResendRecord["status"],
      detail: text(revision.resend_detail),
    });
    resendsByOrder.set(orderId, list);
  }

  const changeOrders = orders.map((row) => mapOrder(row, resendsByOrder.get(text(row.id)) ?? []));
  const lines: JobLineChoice[] = ((lineRows ?? []) as Row[]).map((row) => ({
    id: text(row.id),
    kind: text(row.kind) === "labor" ? "labor" : "material",
    description: text(row.description),
    quantity: num(row.quantity),
    unit: text(row.unit) || "each",
    unitPriceCents: num(row.unit_price_cents),
    adminFeeCents: maybeNum(row.admin_fee_cents),
    invoiceId: text(row.invoice_id) || null,
    billedNote: billedNote(text(row.invoice_id) || null, invoices),
  }));

  return {
    jobId,
    jobNumber: String(found.job_number ?? ""),
    adminFeeBps: num(found.admin_fee_bps),
    agreement: agreement
      ? {
          id: text(agreement.id),
          status: text(agreement.status),
          signed: Boolean(text(agreement.signed_at)),
          signedAt: text(agreement.signed_at) || null,
          totalCents: maybeNum(agreement.total_cents),
        }
      : null,
    totals: contractTotals({
      agreement: agreement ? { id: text(agreement.id), totalCents: maybeNum(agreement.total_cents) } : null,
      changeOrders: changeOrders.map((order) => ({
        id: order.id,
        number: order.number,
        status: order.status,
        netCents: order.netCents,
        approvalMethod: order.approvalMethod,
        baseContractId: order.baseContractId,
      })),
      legacyApprovedCents: legacyApprovedCents(contracts, orders, agreement),
    }),
    changeOrders,
    lines,
    laborRates: [
      ...new Set(lines.filter((line) => line.kind === "labor" && line.unitPriceCents > 0).map((line) => line.unitPriceCents)),
    ].slice(0, 6),
  };
}

/** One change order, by id, in this business. */
export async function loadChangeOrder(
  database: FlexibleSupabaseClient,
  organizationId: string,
  changeOrderId: string,
): Promise<(ChangeOrderRecord & { jobId: string; jobNumber: string }) | null> {
  if (!/^[0-9a-f-]{36}$/i.test(changeOrderId)) return null;
  const { data } = await database
    .from("change_orders")
    .select(`job_id, jobs ( job_number ), ${ORDER_COLUMNS}`)
    .eq("organization_id", organizationId)
    .eq("id", changeOrderId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Row;
  const job = (row.jobs ?? null) as Row | null;
  const loaded = await loadJobChangeOrders(database, organizationId, { jobId: text(row.job_id) });
  const record = loaded?.changeOrders.find((order) => order.id === changeOrderId) ?? mapOrder(row, []);
  return { ...record, jobId: text(row.job_id), jobNumber: String(job?.job_number ?? "") };
}

/**
 * Lines written on the job after the customer signed, which no change order
 * the customer approved covers. A new change order sweeps them in, so what the
 * customer signs is everything that changed — not only what was typed into the
 * change order.
 */
async function unsignedAdditions(
  database: FlexibleSupabaseClient,
  organizationId: string,
  jobId: string,
): Promise<Row[]> {
  const [{ data: contractRows }, { data: lineRows }] = await Promise.all([
    database
      .from("contracts")
      .select("id, kind, status, created_at, signed_at")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId),
    database
      .from("job_line_items")
      .select("id, kind, description, quantity, unit, unit_price_cents, admin_fee_cents, created_at, change_order_id")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId),
  ]);
  const contracts: ContractStanding[] = ((contractRows ?? []) as Row[]).map((contract) => ({
    id: text(contract.id),
    kind: contract.kind === "change_order" ? "change_order" : "agreement",
    status: text(contract.status) || "draft",
    createdAt: text(contract.created_at),
    signedAt: text(contract.signed_at) || null,
  }));
  const lines = ((lineRows ?? []) as Row[]).map((line) => ({
    row: line,
    createdAt: text(line.created_at),
    quantity: num(line.quantity),
    unitPriceCents: num(line.unit_price_cents),
    changeOrderId: text(line.change_order_id) || null,
  }));
  return agreementChanges(lines, contracts).added.map((line) => line.row);
}

/** Sweep additions made since the customer signed into a draft change order, once each. */
async function sweepAdditions(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; jobId: string; changeOrderId: string; userId: string | null },
): Promise<number> {
  const additions = await unsignedAdditions(database, input.organizationId, input.jobId);
  if (additions.length === 0) return 0;
  const { data: existing } = await database
    .from("change_order_items")
    .select("line_id")
    .eq("change_order_id", input.changeOrderId)
    .eq("existing_line", true);
  const swept = new Set(((existing ?? []) as Row[]).map((row) => text(row.line_id)));
  const rows = additions
    .filter((line) => !swept.has(text(line.id)))
    .map((line) => {
      const quantity = num(line.quantity);
      const unitPriceCents = num(line.unit_price_cents);
      return {
        organization_id: input.organizationId,
        job_id: input.jobId,
        change_order_id: input.changeOrderId,
        action: "add",
        kind: text(line.kind) === "labor" ? "labor" : "material",
        description: text(line.description).slice(0, 300) || "Added work",
        quantity,
        unit: text(line.unit) || "each",
        unit_price_cents: unitPriceCents,
        admin_fee_cents: maybeNum(line.admin_fee_cents),
        line_id: text(line.id),
        existing_line: true,
        net_cents: itemNetCents({ action: "add", quantity, unitPriceCents, original: null }),
        created_by: input.userId,
      };
    });
  if (rows.length === 0) return 0;
  const { error } = await database.from("change_order_items").insert(rows);
  if (error) {
    console.error("change orders: additions since signing could not be swept in", error);
    return 0;
  }
  return rows.length;
}

/**
 * Start a change order on a job.
 *
 * A job needs a contract first: a change order changes something agreed, or
 * about to be. Additions written since the customer signed are swept in.
 * Pressing the button twice within half a minute gives back the same draft.
 */
export async function createChangeOrder(
  database: FlexibleSupabaseClient,
  input: {
    organizationId: string;
    job: { jobNumber?: string | number; jobId?: string };
    userId: string | null;
    description: string;
    reason?: string;
    /** The agreement the caller means. Checked against the job's current one when given. */
    contractId?: string;
  },
): Promise<Result<{ changeOrderId: string; number: number; jobNumber: string; swept: number }>> {
  const description = input.description.trim().slice(0, 2000);
  if (!description) return { ok: false, error: "Say what is changing, like \"Customer wants two more outlets in the garage\"." };
  const reason = (input.reason ?? "").trim().slice(0, 2000);

  const job = await findJob(database, input.organizationId, input.job);
  if (!job) return { ok: false, error: "That job could not be found." };
  const jobId = text(job.id);

  const { data: contractRows } = await database
    .from("contracts")
    .select("id, kind, status, created_at, signed_at")
    .eq("organization_id", input.organizationId)
    .eq("job_id", jobId);
  const agreement = currentAgreement((contractRows ?? []) as Row[]);
  if (!agreement) {
    return { ok: false, error: `Job #${job.job_number} has no contract yet. Generate the contract first; a change order changes what it says.` };
  }
  if (input.contractId && input.contractId !== text(agreement.id)) {
    return { ok: false, error: "That contract is not the one this job's change orders amend. Leave it out to use the job's contract." };
  }

  // The same tap arriving twice is the same change order.
  const since = new Date(Date.now() - 30_000).toISOString();
  const { data: recent } = await database
    .from("change_orders")
    .select("id, number")
    .eq("organization_id", input.organizationId)
    .eq("job_id", jobId)
    .eq("status", "draft")
    .eq("description", description)
    .gte("created_at", since)
    .limit(1)
    .maybeSingle();
  if (recent) return { ok: true, changeOrderId: text(recent.id), number: num(recent.number), jobNumber: String(job.job_number ?? ""), swept: 0 };

  const { data: created, error } = await database
    .from("change_orders")
    .insert({
      organization_id: input.organizationId,
      job_id: jobId,
      base_contract_id: text(agreement.id),
      description,
      reason: reason || null,
      status: "draft",
      created_by: input.userId,
    })
    .select("id, number")
    .maybeSingle();
  if (error || !created) {
    console.error("change orders: could not be created", error);
    return { ok: false, error: "The change order could not be saved. Try again." };
  }

  const changeOrderId = text(created.id);
  const swept = agreement.signed_at
    ? await sweepAdditions(database, { organizationId: input.organizationId, jobId, changeOrderId, userId: input.userId })
    : 0;

  await recordActivity(database, {
    organizationId: input.organizationId,
    eventType: "change_order.created",
    label: `Change order #${num(created.number)} started`,
    jobId,
    actorUserId: input.userId,
    metadata: { change_order_id: changeOrderId },
  });

  return { ok: true, changeOrderId, number: num(created.number), jobNumber: String(job.job_number ?? ""), swept };
}

/** A draft change order the caller may edit, with its job's admin fee rate. */
async function editableOrder(
  database: FlexibleSupabaseClient,
  organizationId: string,
  changeOrderId: string,
): Promise<Result<{ row: Row; jobId: string; adminFeeBps: number }>> {
  if (!/^[0-9a-f-]{36}$/i.test(changeOrderId)) return { ok: false, error: "That change order could not be found." };
  const { data } = await database
    .from("change_orders")
    .select("id, job_id, number, status, version, jobs ( admin_fee_bps )")
    .eq("organization_id", organizationId)
    .eq("id", changeOrderId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That change order could not be found." };
  const row = data as Row;
  if (!canEditChangeOrder(text(row.status))) {
    return {
      ok: false,
      error:
        text(row.status) === "pending_approval"
          ? `Change order #${num(row.number)} is with the customer. Withdraw it to change it.`
          : `Change order #${num(row.number)} is ${STATUS_LABELS[text(row.status) as ChangeOrderStatus]?.toLowerCase() ?? "closed"} and can no longer change.`,
    };
  }
  const job = (row.jobs ?? null) as Row | null;
  return { ok: true, row, jobId: text(row.job_id), adminFeeBps: num(job?.admin_fee_bps) };
}

/** Moves the change order's version on, so a stale editor finds out. Only while it is still a draft. */
async function touchVersion(
  database: FlexibleSupabaseClient,
  organizationId: string,
  changeOrderId: string,
  current: number,
  expected?: number,
): Promise<boolean> {
  if (typeof expected === "number" && expected !== current) return false;
  const { data } = await database
    .from("change_orders")
    .update({ version: current + 1 })
    .eq("organization_id", organizationId)
    .eq("id", changeOrderId)
    .eq("status", "draft")
    .eq("version", current)
    .select("id")
    .maybeSingle();
  return Boolean(data);
}

const STALE = "Somebody else changed this change order a moment ago. Reload it to see their changes before making yours.";

export type ItemInput = {
  action: ChangeOrderAction;
  kind?: string;
  description?: string;
  /** As typed: "2", "1.5", "50 ft". */
  quantity?: string;
  unit?: string;
  /**
   * The business's price each, as typed, before the admin fee (the same as a
   * line added to the job). Blank: unpriced for an addition, unchanged for a
   * change. Ignored for a removal.
   */
  unitPrice?: string;
  unitCost?: string;
  lineId?: string;
  inventoryItemId?: string;
  notes?: string;
  /** The caller's own key for this item: the same key twice adds one item. */
  requestKey?: string;
  /** The version the editor was looking at, so two people cannot overwrite each other. */
  expectedVersion?: number;
};

/**
 * Add one change to a draft: new work, a change to a line on the job, or a
 * line taken out.
 *
 * Prices are only set by somebody the business lets change billing. Anybody
 * else can still write the change down unpriced, for somebody who may price it.
 */
export async function addChangeOrderItem(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; actor: ChangeOrderActor; item: ItemInput },
): Promise<Result<{ itemId: string; duplicate: boolean }>> {
  const order = await editableOrder(database, input.organizationId, input.changeOrderId);
  if (!order.ok) return order;
  const { item } = input;
  const requestKey = (item.requestKey ?? "").trim().slice(0, 120) || null;

  if (requestKey) {
    const { data: earlier } = await database
      .from("change_order_items")
      .select("id")
      .eq("change_order_id", input.changeOrderId)
      .eq("request_key", requestKey)
      .maybeSingle();
    if (earlier) return { ok: true, itemId: text(earlier.id), duplicate: true };
  }

  const built = await buildItemRow(database, {
    organizationId: input.organizationId,
    changeOrderId: input.changeOrderId,
    jobId: order.jobId,
    adminFeeBps: order.adminFeeBps,
    actor: input.actor,
    item,
  });
  if (!built.ok) return built;

  if (!(await touchVersion(database, input.organizationId, input.changeOrderId, num(order.row.version), item.expectedVersion))) {
    return { ok: false, error: STALE };
  }

  const { data: created, error } = await database
    .from("change_order_items")
    .insert({ ...built.row, request_key: requestKey, created_by: input.actor.userId })
    .select("id")
    .maybeSingle();
  if (error || !created) {
    if (error?.code === "23505" && requestKey) {
      const { data: earlier } = await database
        .from("change_order_items")
        .select("id")
        .eq("change_order_id", input.changeOrderId)
        .eq("request_key", requestKey)
        .maybeSingle();
      if (earlier) return { ok: true, itemId: text(earlier.id), duplicate: true };
    }
    console.error("change orders: item could not be saved", error);
    return { ok: false, error: "That change could not be saved. Try again." };
  }
  return { ok: true, itemId: text(created.id), duplicate: false };
}

async function buildItemRow(
  database: FlexibleSupabaseClient,
  input: {
    organizationId: string;
    changeOrderId: string;
    jobId: string;
    adminFeeBps: number;
    actor: ChangeOrderActor;
    item: ItemInput;
    /** When editing an item, the item itself, so its own line is not counted twice. */
    editingItemId?: string;
  },
): Promise<Result<{ row: Row }>> {
  const { item } = input;
  const action = item.action;
  if (!["add", "modify", "remove"].includes(action)) return { ok: false, error: "Choose add, change or remove." };

  const price = readPrice(item.unitPrice);
  if (price.state === "invalid") return { ok: false, error: "That price could not be read. Something like 59.99 works." };
  if (price.state === "set" && !input.actor.canSetPrices && action !== "remove") {
    return {
      ok: false,
      error: "Your business owner has turned off billing changes for technicians, so you cannot set prices. Leave the price blank and an owner or admin can price it.",
    };
  }
  const cost = readPrice(item.unitCost);
  if (cost.state === "invalid") return { ok: false, error: "Your cost could not be read. Something like 4.20 works, or leave it blank." };
  const notes = (item.notes ?? "").trim().slice(0, 1000) || null;

  if (action === "add") {
    const kind: ChangeOrderKind = item.kind === "labor" ? "labor" : "material";
    const description = (item.description ?? "").trim().slice(0, 300);
    if (!description) return { ok: false, error: kind === "labor" ? "What is the work?" : "What is the part?" };
    const quantity = parseQuantity(item.quantity || "1");
    if (quantity === null) return { ok: false, error: "That quantity could not be read. A number like 2 or 1.5 works." };
    const unit = kind === "labor" ? "hr" : ((item.unit ?? "").trim().slice(0, 24) || "each");

    let inventoryItemId: string | null = null;
    if (item.inventoryItemId) {
      const { data: stock } = await database
        .from("inventory_items")
        .select("id")
        .eq("organization_id", input.organizationId)
        .eq("id", item.inventoryItemId)
        .maybeSingle();
      if (!stock) return { ok: false, error: "That part is not in your stock list." };
      inventoryItemId = text(stock.id);
    }

    // The customer's price is the business's price with the job's admin fee
    // in, the same as the database does for every line written on a job.
    const fee = price.state === "set" ? adminFeeOn(price.cents, input.adminFeeBps) : null;
    const unitPriceCents = price.state === "set" ? price.cents + (fee ?? 0) : null;
    return {
      ok: true,
      row: {
        organization_id: input.organizationId,
        job_id: input.jobId,
        change_order_id: input.changeOrderId,
        action,
        kind,
        description,
        quantity,
        unit,
        unit_price_cents: unitPriceCents,
        admin_fee_cents: fee,
        unit_cost_cents: kind === "material" && cost.state === "set" ? cost.cents : null,
        inventory_item_id: inventoryItemId,
        notes,
        net_cents: itemNetCents({ action, quantity, unitPriceCents, original: null }),
      },
    };
  }

  const lineId = (item.lineId ?? "").trim();
  if (!/^[0-9a-f-]{36}$/i.test(lineId)) return { ok: false, error: "Choose the item on the contract to change or remove." };
  const { data: lineRow } = await database
    .from("job_line_items")
    .select("id, kind, description, quantity, unit, unit_price_cents, admin_fee_cents, invoice_id")
    .eq("organization_id", input.organizationId)
    .eq("job_id", input.jobId)
    .eq("id", lineId)
    .maybeSingle();
  if (!lineRow) return { ok: false, error: "That item is not on this job." };
  const line = lineRow as Row;

  // One change per line per change order: two would contradict each other.
  let others = database
    .from("change_order_items")
    .select("id")
    .eq("change_order_id", input.changeOrderId)
    .eq("line_id", lineId)
    .in("action", ["modify", "remove"]);
  if (input.editingItemId) others = others.neq("id", input.editingItemId);
  const { data: already } = await others.limit(1);
  if (Array.isArray(already) && already.length > 0) {
    return { ok: false, error: `"${text(line.description)}" is already changed in this change order. Edit that change instead.` };
  }

  const original = {
    description: text(line.description),
    quantity: num(line.quantity),
    unit: text(line.unit) || "each",
    unitPriceCents: num(line.unit_price_cents),
  };
  const base = {
    organization_id: input.organizationId,
    job_id: input.jobId,
    change_order_id: input.changeOrderId,
    action,
    kind: text(line.kind) === "labor" ? "labor" : "material",
    line_id: lineId,
    original_description: original.description,
    original_quantity: original.quantity,
    original_unit: original.unit,
    original_unit_price_cents: original.unitPriceCents,
    original_admin_fee_cents: maybeNum(line.admin_fee_cents),
    original_invoice_id: text(line.invoice_id) || null,
    notes,
  };

  if (action === "remove") {
    return {
      ok: true,
      row: {
        ...base,
        description: original.description.slice(0, 300),
        quantity: original.quantity,
        unit: original.unit,
        unit_price_cents: null,
        admin_fee_cents: null,
        net_cents: itemNetCents({ action, quantity: original.quantity, unitPriceCents: null, original }),
      },
    };
  }

  const description = ((item.description ?? "").trim() || original.description).slice(0, 300);
  const quantity = item.quantity ? parseQuantity(item.quantity) : original.quantity;
  if (quantity === null) return { ok: false, error: "That quantity could not be read. A number like 2 or 1.5 works." };
  // A price left blank keeps the line's price, fee and all. A new one is the
  // business's price, with the job's admin fee put in.
  const fee = price.state === "set" ? adminFeeOn(price.cents, input.adminFeeBps) : maybeNum(line.admin_fee_cents);
  const unitPriceCents = price.state === "set" ? price.cents + (fee ?? 0) : original.unitPriceCents;
  return {
    ok: true,
    row: {
      ...base,
      description,
      quantity,
      unit: original.unit,
      unit_price_cents: unitPriceCents,
      admin_fee_cents: fee,
      net_cents: itemNetCents({ action, quantity, unitPriceCents, original }),
    },
  };
}

/** Change one item on a draft: its quantity, price, description or notes. */
export async function updateChangeOrderItem(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; itemId: string; actor: ChangeOrderActor; item: ItemInput },
): Promise<Result> {
  const order = await editableOrder(database, input.organizationId, input.changeOrderId);
  if (!order.ok) return order;
  const { data: existing } = await database
    .from("change_order_items")
    .select("id, action, kind, line_id, existing_line, unit_price_cents")
    .eq("change_order_id", input.changeOrderId)
    .eq("id", input.itemId)
    .maybeSingle();
  if (!existing) return { ok: false, error: "That change could not be found." };
  const row = existing as Row;
  if (row.existing_line === true) {
    return { ok: false, error: "That item is already on the job. Change it on the job, or add a change to it here." };
  }

  const built = await buildItemRow(database, {
    organizationId: input.organizationId,
    changeOrderId: input.changeOrderId,
    jobId: order.jobId,
    adminFeeBps: order.adminFeeBps,
    actor: input.actor,
    item: { ...input.item, action: text(row.action) as ChangeOrderAction, lineId: text(row.line_id) || input.item.lineId, kind: input.item.kind ?? text(row.kind) },
    editingItemId: input.itemId,
  });
  if (!built.ok) return built;
  // Someone who may not set prices can still change a quantity; the price they
  // could not have set stays as it was.
  if (!input.actor.canSetPrices && text(row.action) === "add") {
    built.row.unit_price_cents = maybeNum(row.unit_price_cents);
  }

  if (!(await touchVersion(database, input.organizationId, input.changeOrderId, num(order.row.version), input.item.expectedVersion))) {
    return { ok: false, error: STALE };
  }
  const { error } = await database
    .from("change_order_items")
    .update(built.row)
    .eq("change_order_id", input.changeOrderId)
    .eq("id", input.itemId);
  if (error) {
    console.error("change orders: item could not be updated", error);
    return { ok: false, error: "That change could not be saved. Try again." };
  }
  return { ok: true };
}

/** Take one item off a draft. */
export async function removeChangeOrderItem(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; itemId: string; expectedVersion?: number },
): Promise<Result> {
  const order = await editableOrder(database, input.organizationId, input.changeOrderId);
  if (!order.ok) return order;
  if (!(await touchVersion(database, input.organizationId, input.changeOrderId, num(order.row.version), input.expectedVersion))) {
    return { ok: false, error: STALE };
  }
  const { data, error } = await database
    .from("change_order_items")
    .delete()
    .eq("change_order_id", input.changeOrderId)
    .eq("id", input.itemId)
    .select("id");
  if (error || !Array.isArray(data) || data.length === 0) return { ok: false, error: "That change could not be removed." };
  return { ok: true };
}

/** Edit a draft's description or reason. */
export async function updateChangeOrder(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; description?: string; reason?: string; expectedVersion?: number },
): Promise<Result> {
  const order = await editableOrder(database, input.organizationId, input.changeOrderId);
  if (!order.ok) return order;
  const patch: Row = {};
  if (typeof input.description === "string") {
    const description = input.description.trim().slice(0, 2000);
    if (!description) return { ok: false, error: "Say what is changing." };
    patch.description = description;
  }
  if (typeof input.reason === "string") patch.reason = input.reason.trim().slice(0, 2000) || null;
  if (Object.keys(patch).length === 0) return { ok: true };

  const current = num(order.row.version);
  if (typeof input.expectedVersion === "number" && input.expectedVersion !== current) return { ok: false, error: STALE };
  const { data } = await database
    .from("change_orders")
    .update({ ...patch, version: current + 1 })
    .eq("organization_id", input.organizationId)
    .eq("id", input.changeOrderId)
    .eq("status", "draft")
    .eq("version", current)
    .select("id")
    .maybeSingle();
  return data ? { ok: true } : { ok: false, error: STALE };
}

function dateIn(timeZone: string, iso: string, weekday: boolean): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    ...(weekday ? { weekday: "short" as const } : {}),
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(iso));
}

/**
 * Put a draft in front of the customer: write the document they sign, and wait.
 *
 * Only against a signed contract — an unsigned one is updated instead
 * (`foldIntoContract`), so the customer is never asked to sign a change to a
 * contract they have not signed. Nothing is texted here: the document is the
 * job's newest contract, sent or signed in person the way every contract is.
 */
export async function requestChangeOrderApproval(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; userId: string | null; expectedVersion?: number },
): Promise<Result<{ contractId: string; netCents: number; revisedCents: number | null; jobNumber: string; pdfError: string }>> {
  const order = await editableOrder(database, input.organizationId, input.changeOrderId);
  if (!order.ok) return order;
  const current = num(order.row.version);
  if (typeof input.expectedVersion === "number" && input.expectedVersion !== current) return { ok: false, error: STALE };

  const loaded = await loadJobChangeOrders(database, input.organizationId, { jobId: order.jobId });
  if (!loaded) return { ok: false, error: "That job could not be found." };
  if (!loaded.agreement) return { ok: false, error: "This job has no contract to change." };
  if (!loaded.agreement.signed) {
    return {
      ok: false,
      error: "The customer has not signed the contract yet. Update the contract with these changes instead, so they sign one document with everything in it.",
    };
  }
  const pending = loaded.changeOrders.find((entry) => entry.status === "pending_approval");
  if (pending) {
    return { ok: false, error: `Change order #${pending.number} is already with the customer. It needs an answer (or withdrawing) first.` };
  }

  // Additions since signing go in too, so the document covers everything new.
  await sweepAdditions(database, { organizationId: input.organizationId, jobId: order.jobId, changeOrderId: input.changeOrderId, userId: input.userId });
  const refreshed = await loadJobChangeOrders(database, input.organizationId, { jobId: order.jobId });
  const record = refreshed?.changeOrders.find((entry) => entry.id === input.changeOrderId);
  if (!refreshed || !record) return { ok: false, error: "That change order could not be found." };

  const notReady = itemsNotReadyBecause(record.items);
  if (notReady) return { ok: false, error: notReady };
  for (const item of record.items) {
    if (item.action === "add") continue;
    const line = refreshed.lines.find((entry) => entry.id === item.lineId);
    if (!lineMatchesOriginal(line, item.original)) {
      return {
        ok: false,
        error: `"${item.original?.description ?? item.description}" has changed on the job since it was added here. Remove that change and add it again.`,
      };
    }
  }

  const job = await findJob(database, input.organizationId, { jobId: order.jobId });
  const customer = (job?.customers ?? null) as Row | null;
  const property = (job?.properties ?? null) as Row | null;
  const organization = (job?.organizations ?? null) as Row | null;
  const timeZone = text(organization?.timezone) || "America/Los_Angeles";
  const contractBefore = refreshed.totals.committedCents;
  const netCents = record.summary.netCents;

  const document = changeOrderDocument({
    number: record.number,
    facts: {
      business_name: text(organization?.name),
      business_phone: text(organization?.phone),
      customer_name: billingParty(customer, null).name,
      service_address: serviceAddress(property, customer),
      job_number: String(job?.job_number ?? ""),
      today: dateIn(timeZone, new Date().toISOString(), true),
    },
    signedOn: dateIn(timeZone, refreshed.agreement?.signedAt ?? "", false),
    description: record.description,
    reason: record.reason,
    items: record.items,
    contractBeforeCents: contractBefore,
  });

  const { data: contract, error: contractError } = await database
    .from("contracts")
    .insert({
      organization_id: input.organizationId,
      job_id: order.jobId,
      kind: "change_order",
      body: document.body,
      scope: "",
      unfilled: document.unfilled,
      status: "draft",
      // The contract figure cannot be negative; a change order that takes money
      // off states it in its words and on its change order record instead.
      total_cents: netCents >= 0 ? netCents : null,
      deposit_cents: 0,
      deposit_paid: false,
    })
    .select("id")
    .maybeSingle();
  if (contractError || !contract) {
    console.error("change orders: document could not be written", contractError);
    return { ok: false, error: "The change order document could not be saved. Try again." };
  }
  const contractId = text(contract.id);

  const { data: claimed, error: claimError } = await database
    .from("change_orders")
    .update({
      status: "pending_approval",
      document_contract_id: contractId,
      net_cents: netCents,
      original_contract_cents: contractBefore,
      requested_at: new Date().toISOString(),
      requested_by: input.userId,
      version: current + 1,
    })
    .eq("organization_id", input.organizationId)
    .eq("id", input.changeOrderId)
    .eq("status", "draft")
    .eq("version", current)
    .select("id")
    .maybeSingle();
  if (claimError || !claimed) {
    // Nobody is asked to sign a document whose change order moved underneath it.
    await database.from("contracts").delete().eq("id", contractId).eq("organization_id", input.organizationId).is("signed_at", null);
    return {
      ok: false,
      error:
        claimError?.code === "23505"
          ? "Another change order on this job is already with the customer."
          : STALE,
    };
  }

  const { generateContractPdf } = await import("@/lib/pdf/contract-data");
  const pdf = await generateContractPdf({
    database,
    organizationId: input.organizationId,
    contractId,
    timeZone,
    uploadedBy: input.userId ?? "",
  });

  await recordActivity(database, {
    organizationId: input.organizationId,
    eventType: "change_order.requested",
    label: `Change order #${record.number} ready for the customer to sign`,
    jobId: order.jobId,
    actorUserId: input.userId,
    metadata: { change_order_id: input.changeOrderId, contract_id: contractId, net_cents: netCents },
  });

  return {
    ok: true,
    contractId,
    netCents,
    revisedCents: contractBefore === null ? null : contractBefore + netCents,
    jobNumber: String(job?.job_number ?? ""),
    pdfError: pdf.error,
  };
}

/**
 * Withdraw a change order: a draft, or one the customer has not answered.
 *
 * The document is voided first, and only if it is still unsigned — so a
 * customer signing at the same moment either signs first (and the change order
 * is approved, not withdrawn) or finds a document that can no longer be signed.
 */
export async function cancelChangeOrder(
  database: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; userId: string | null; declinedByCustomer?: boolean; reason?: string },
): Promise<Result<{ number: number }>> {
  const { data } = await database
    .from("change_orders")
    .select("id, job_id, number, status, document_contract_id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.changeOrderId)
    .maybeSingle();
  if (!data) return { ok: false, error: "That change order could not be found." };
  const row = data as Row;
  const status = text(row.status);
  if (input.declinedByCustomer ? status !== "pending_approval" : status !== "draft" && status !== "pending_approval") {
    return { ok: false, error: `Change order #${num(row.number)} is ${STATUS_LABELS[status as ChangeOrderStatus]?.toLowerCase() ?? status} and cannot be ${input.declinedByCustomer ? "declined" : "withdrawn"}.` };
  }

  if (status === "pending_approval" && text(row.document_contract_id)) {
    const { data: voided } = await database
      .from("contracts")
      .update({ status: "void" })
      .eq("organization_id", input.organizationId)
      .eq("id", text(row.document_contract_id))
      .is("signed_at", null)
      .select("id")
      .maybeSingle();
    if (!voided) return { ok: false, error: "The customer has just signed it. Reload the job." };
  }

  const now = new Date().toISOString();
  const { data: updated } = await database
    .from("change_orders")
    .update(
      input.declinedByCustomer
        ? { status: "rejected", rejected_at: now, rejection_reason: (input.reason ?? "").trim().slice(0, 1000) || "Declined, as recorded by the business" }
        : { status: "canceled", canceled_at: now, canceled_by: input.userId },
    )
    .eq("organization_id", input.organizationId)
    .eq("id", input.changeOrderId)
    .in("status", ["draft", "pending_approval"])
    .select("id")
    .maybeSingle();
  if (!updated) return { ok: false, error: "That change order changed a moment ago. Reload the job." };

  await recordActivity(database, {
    organizationId: input.organizationId,
    eventType: input.declinedByCustomer ? "change_order.rejected" : "change_order.canceled",
    label: input.declinedByCustomer ? `Change order #${num(row.number)} declined by the customer` : `Change order #${num(row.number)} withdrawn`,
    jobId: text(row.job_id),
    actorUserId: input.userId,
    metadata: { change_order_id: input.changeOrderId },
  });
  return { ok: true, number: num(row.number) };
}

export type ApplyOutcome = {
  ok: boolean;
  message: string;
  creditDueCents: number;
  /** Updated invoices sent (or tried). */
  resent: { invoiceNumber: string; ok: boolean; message: string }[];
  supplementalInvoiceId: string | null;
};

type PlanSnapshot = {
  number: number;
  jobId: string;
  billedJob: BilledJob;
  items: PlanItem[];
  lines: PlanLine[];
  invoices: PlanInvoice[];
  creditLeftCents: number;
};

async function planSnapshot(admin: FlexibleSupabaseClient, organizationId: string, changeOrderId: string): Promise<PlanSnapshot | null> {
  const { data } = await admin
    .from("change_orders")
    .select(`job_id, ${ORDER_COLUMNS}, jobs ( id, diagnostic_paid, diagnostic_fee_cents, follow_up_of )`)
    .eq("organization_id", organizationId)
    .eq("id", changeOrderId)
    .maybeSingle();
  if (!data) return null;
  const row = data as Row;
  const job = (row.jobs ?? null) as Row | null;
  const jobId = text(row.job_id);
  const billedJob: BilledJob = {
    id: jobId,
    followUpOf: text(job?.follow_up_of) || null,
    diagnosticPaid: job?.diagnostic_paid === true,
    diagnosticFeeCents: num(job?.diagnostic_fee_cents),
  };

  const [{ data: lineRows }, invoices, { data: inFlight }, creditLeftCents] = await Promise.all([
    admin
      .from("job_line_items")
      .select("id, kind, description, quantity, unit, unit_price_cents, admin_fee_cents, invoice_id")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId),
    jobInvoices(admin, organizationId, jobId),
    admin
      .from("invoice_online_payments")
      .select("invoice_id")
      .eq("organization_id", organizationId)
      .eq("job_id", jobId)
      .eq("status", "processing"),
    diagnosticCreditLeft(admin, organizationId, billedJob),
  ]);
  const processing = new Set(((inFlight ?? []) as Row[]).map((entry) => text(entry.invoice_id)));
  const items: PlanItem[] = mapOrder(row, []).items;

  return {
    number: num(row.number),
    jobId,
    billedJob,
    items,
    lines: ((lineRows ?? []) as Row[]).map((line) => ({
      id: text(line.id),
      kind: text(line.kind) === "labor" ? "labor" : "material",
      description: text(line.description),
      quantity: num(line.quantity),
      unit: text(line.unit) || "each",
      unitPriceCents: num(line.unit_price_cents),
      adminFeeCents: maybeNum(line.admin_fee_cents),
      invoiceId: text(line.invoice_id) || null,
    })),
    invoices: invoices.map((invoice) => ({
      id: invoice.id,
      number: invoice.number,
      status: invoice.status,
      lastSentAt: invoice.lastSentAt,
      paidAt: invoice.paidAt,
      createdAt: invoice.createdAt,
      subtotalCents: invoice.subtotalCents,
      taxCents: invoice.taxCents,
      diagnosticCreditCents: invoice.diagnosticCreditCents,
      totalCents: invoice.totalCents,
      balanceDueCents: invoice.balanceDueCents,
      discount: invoice.discount,
      stripeInvoiceId: invoice.stripeInvoiceId,
      revisionNumber: invoice.revisionNumber,
      paymentInFlight: processing.has(invoice.id),
    })),
    creditLeftCents,
  };
}

/**
 * Carry out an approved change order, and everything that follows from it.
 *
 * 1. Lines and invoices move together in `apply_change_order`, from a plan
 *    worked out here. A plan made stale by a payment or an edit landing at the
 *    same moment is worked out again, twice at most.
 * 2. The documents of the invoices that moved are laid out again — a new
 *    version each, so the copy the customer already has stays on file.
 * 3. New work the newest (paid) invoice cannot take goes on a new invoice for
 *    the difference, sent to the customer.
 * 4. Each sent invoice whose amount changed is sent again, marked updated, once.
 *
 * Safe to call again: an applied change order is not applied twice, and a sent
 * update is not sent twice. Uses the service role throughout; the caller has
 * already established that this business's change order was approved.
 */
export async function applyApprovedChangeOrder(
  admin: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; actorUserId?: string | null },
): Promise<ApplyOutcome> {
  const outcome: ApplyOutcome = { ok: false, message: "", creditDueCents: 0, resent: [], supplementalInvoiceId: null };

  const { data: header } = await admin
    .from("change_orders")
    .select("id, job_id, number, status, applied_at, credit_due_cents")
    .eq("organization_id", input.organizationId)
    .eq("id", input.changeOrderId)
    .maybeSingle();
  if (!header) return { ...outcome, message: "That change order could not be found." };
  const head = header as Row;
  if (text(head.status) !== "approved") {
    return { ...outcome, message: `Change order #${num(head.number)} is not approved, so nothing was changed.` };
  }

  let touched: string[] = [];
  let needsSupplemental = false;
  let revisions: { revision_id: string; invoice_id: string; resend: boolean }[] = [];

  if (!text(head.applied_at)) {
    let applied = false;
    let lastError = "";
    for (let attempt = 0; attempt < 3 && !applied; attempt += 1) {
      const snapshot = await planSnapshot(admin, input.organizationId, input.changeOrderId);
      if (!snapshot) return { ...outcome, message: "That change order could not be found." };
      const planned = planChangeOrder({
        changeOrderNumber: snapshot.number,
        items: snapshot.items,
        lines: snapshot.lines,
        invoices: snapshot.invoices,
        creditLeftCents: snapshot.creditLeftCents,
        newId: () => randomUUID(),
      });
      if (!planned.ok) {
        lastError = planned.reason;
        break;
      }
      const { data, error } = await admin.rpc("apply_change_order", {
        p_change_order_id: input.changeOrderId,
        p_plan: planned.plan,
      });
      if (error) {
        lastError = error.message;
        if (error.code === "40001") continue;
        break;
      }
      const result = (data ?? {}) as { already_applied?: boolean; revisions?: typeof revisions };
      applied = true;
      if (!result.already_applied) {
        touched = planned.plan.touchedInvoiceIds;
        needsSupplemental = planned.plan.needsSupplementalInvoice;
        revisions = Array.isArray(result.revisions) ? result.revisions : [];
        outcome.creditDueCents = planned.plan.creditDueCents;
      }
    }
    if (!applied) {
      await recordActivity(admin, {
        organizationId: input.organizationId,
        eventType: "change_order.apply_failed",
        label: `Change order #${num(head.number)} approved but not yet applied`,
        jobId: text(head.job_id),
        metadata: { change_order_id: input.changeOrderId, reason: lastError },
      });
      return {
        ...outcome,
        message: `Change order #${num(head.number)} is approved, but the job could not be updated: ${lastError || "try again"}.`,
      };
    }
    await recordActivity(admin, {
      organizationId: input.organizationId,
      eventType: "change_order.applied",
      label: `Change order #${num(head.number)} applied to the job`,
      jobId: text(head.job_id),
      actorUserId: input.actorUserId ?? null,
      metadata: { change_order_id: input.changeOrderId, credit_due_cents: outcome.creditDueCents },
    });
  } else {
    outcome.creditDueCents = num(head.credit_due_cents);
  }

  const uploadedBy = input.actorUserId ?? "";
  for (const invoiceId of touched) {
    await rebuildInvoiceDocument(admin, { organizationId: input.organizationId, invoiceId, uploadedBy });
  }

  const { raiseSupplementalInvoice, resendPendingRevisions } = await import("@/lib/invoice-revision-server");
  if (needsSupplemental) {
    const supplemental = await raiseSupplementalInvoice(admin, {
      organizationId: input.organizationId,
      jobId: text(head.job_id),
      changeOrderNumber: num(head.number),
      uploadedBy,
    });
    outcome.supplementalInvoiceId = supplemental.invoiceId;
    if (supplemental.sent) outcome.resent.push(supplemental.sent);
  }

  // Every update this change order still owes the customer, including ones a
  // failed earlier attempt left behind.
  outcome.resent.push(
    ...(await resendPendingRevisions(admin, {
      organizationId: input.organizationId,
      changeOrderId: input.changeOrderId,
      revisionIds: revisions.filter((revision) => revision.resend).map((revision) => revision.revision_id),
    })),
  );

  outcome.ok = true;
  const parts = [`Change order #${num(head.number)} is applied to the job.`];
  if (outcome.creditDueCents > 0) parts.push(`The customer is owed a ${formatCents(outcome.creditDueCents)} credit: refund it from the invoice's payments.`);
  for (const sent of outcome.resent) parts.push(sent.ok ? `Updated INV-${sent.invoiceNumber} sent: ${sent.message}` : `Updated INV-${sent.invoiceNumber} not sent: ${sent.message}`);
  outcome.message = parts.join(" ");
  return outcome;
}

/**
 * An unsigned contract, updated with a change instead of amended by one.
 *
 * The change order is recorded as folded into the contract (not as a customer
 * approval — the customer has approved nothing yet), the job's lines take the
 * change, and a fresh draft of the contract is written from them. The outdated
 * draft stays on file as an earlier version, cannot be signed, and its signing
 * link (if one went out) is withdrawn.
 */
export async function foldIntoContract(
  database: FlexibleSupabaseClient,
  admin: FlexibleSupabaseClient,
  input: { organizationId: string; changeOrderId: string; userId: string | null },
): Promise<Result<{ jobNumber: string; applied: ApplyOutcome }>> {
  const order = await editableOrder(database, input.organizationId, input.changeOrderId);
  if (!order.ok) return order;
  const loaded = await loadJobChangeOrders(database, input.organizationId, { jobId: order.jobId });
  const record = loaded?.changeOrders.find((entry) => entry.id === input.changeOrderId);
  if (!loaded || !record) return { ok: false, error: "That change order could not be found." };
  if (loaded.agreement?.signed) {
    return { ok: false, error: "The customer has signed the contract, so it cannot be updated. Send them the change order to sign instead." };
  }
  const notReady = itemsNotReadyBecause(record.items);
  if (notReady) return { ok: false, error: notReady };

  // What the change adds, recorded while it is still a draft (an approved one
  // is history). It is for the record only: the new draft's own figure already
  // includes it, and the contract total does not count it a second time.
  const { data: noted } = await database
    .from("change_orders")
    .update({ net_cents: record.summary.netCents, original_contract_cents: loaded.totals.committedCents, version: record.version + 1 })
    .eq("organization_id", input.organizationId)
    .eq("id", input.changeOrderId)
    .eq("status", "draft")
    .eq("version", record.version)
    .select("id")
    .maybeSingle();
  if (!noted) return { ok: false, error: STALE };

  const { error } = await database.rpc("approve_change_order_as_contract_revision", { p_change_order_id: input.changeOrderId });
  if (error) {
    return { ok: false, error: error.code === "22023" ? `The contract could not be updated: ${error.message}.` : "The contract could not be updated. Try again." };
  }

  const applied = await applyApprovedChangeOrder(admin, {
    organizationId: input.organizationId,
    changeOrderId: input.changeOrderId,
    actorUserId: input.userId,
  });

  // Any signing link out for the old draft is withdrawn: it already refuses to
  // sign (it is no longer the newest), and this stops it reading as sent.
  await database
    .from("contracts")
    .update({ status: "draft" })
    .eq("organization_id", input.organizationId)
    .eq("job_id", order.jobId)
    .eq("kind", "agreement")
    .eq("status", "sent")
    .is("signed_at", null);

  return { ok: true, jobNumber: loaded.jobNumber, applied };
}
