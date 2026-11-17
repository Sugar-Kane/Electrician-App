/**
 * What approving a change order does to the job's lines and invoices.
 *
 * Worked out here, as a plan, from a snapshot of the job; then carried out by
 * `apply_change_order` in the database in one transaction, which checks first
 * that nothing in the snapshot has moved. So the arithmetic lives in one place
 * (this file, through `invoiceTotals`), and a half-applied change order cannot
 * exist: either every line and invoice moves, or none does.
 *
 * Where each change lands depends on the invoice that billed the line it
 * touches, and on the job's newest invoice for anything new:
 *
 * - no invoice yet: the lines change, and the first invoice bills them as they
 *   now are;
 * - a draft the customer has not seen: the draft follows, quietly;
 * - sent and not fully paid: the invoice is revised — its figures move, the
 *   figures it had are kept as a revision, payments already made stay counted,
 *   and the customer is sent the updated invoice;
 * - fully paid, collected through a Stripe invoice, or with a bank payment on
 *   its way: its figures never move. More work goes on a new invoice for the
 *   difference; less work is a credit the business owes, said out loud.
 *
 * Import-free apart from the shared money rules, so every case is tested.
 */

import { lineAdminFee } from "./admin-fee.ts";
import { lineMatchesOriginal, type ChangeOrderItem } from "./change-order-math.ts";
import { invoiceTotals, type InvoiceDiscount } from "./invoice-math.ts";
import { lineTotalCents } from "./job-lines.ts";

export type PlanLine = {
  id: string;
  kind: "labor" | "material";
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  /** Admin fee included in the price, per unit. Null on lines from before the fee. */
  adminFeeCents: number | null;
  invoiceId: string | null;
};

export type PlanItem = ChangeOrderItem & {
  /** Admin fee included in unitPriceCents, per unit. */
  adminFeeCents: number | null;
  unitCostCents?: number | null;
  inventoryItemId?: string | null;
};

export type PlanInvoice = {
  id: string;
  number: string;
  status: string;
  lastSentAt: string | null;
  paidAt: string | null;
  createdAt: string;
  subtotalCents: number;
  taxCents: number;
  diagnosticCreditCents: number;
  totalCents: number;
  balanceDueCents: number;
  discount: InvoiceDiscount | null;
  stripeInvoiceId: string | null;
  revisionNumber: number;
  /** A bank payment on this invoice is on its way and has not cleared. */
  paymentInFlight: boolean;
};

/**
 * Where an invoice stands, for a change order.
 *
 * - draft: the customer has not been sent it; it may move freely.
 * - revisable: sent, not fully paid, collected by Volteira itself.
 * - settled: paid in full, collected through a Stripe invoice, or with money
 *   on its way. Its figures never move.
 * - void: billed nothing.
 */
export type InvoiceStanding = "draft" | "revisable" | "settled" | "void";

export function invoiceStanding(
  invoice: Pick<PlanInvoice, "status" | "lastSentAt" | "paidAt" | "stripeInvoiceId" | "paymentInFlight">,
): InvoiceStanding {
  if (invoice.status === "void") return "void";
  if (invoice.status === "paid" || invoice.paidAt || invoice.stripeInvoiceId || invoice.paymentInFlight) return "settled";
  if (invoice.status === "draft" && !invoice.lastSentAt) return "draft";
  if (["draft", "sent", "overdue", "partially_paid"].includes(invoice.status)) return "revisable";
  return "settled";
}

export type ItemEffect = "unbilled" | "draft" | "revision" | "supplemental" | "credit" | "none";

export type LineInsert = {
  id: string;
  item_id: string;
  kind: "labor" | "material";
  description: string;
  quantity: number;
  unit: string;
  unit_price_cents: number;
  admin_fee_cents: number;
  unit_cost_cents: number | null;
  inventory_item_id: string | null;
  notes: string | null;
  invoice_id: string | null;
};

export type LineUpdate = {
  id: string;
  item_id: string;
  /** What the line must still say, or the plan is stale. */
  expected: { quantity: number; unit_price_cents: number; invoice_id: string | null };
  next: { description: string; quantity: number; unit: string; unit_price_cents: number; admin_fee_cents: number };
};

export type LineDelete = {
  id: string;
  item_id: string;
  expected: { quantity: number; unit_price_cents: number; invoice_id: string | null };
};

export type InvoiceRevision = {
  invoice_id: string;
  invoice_number: string;
  standing: "draft" | "revisable";
  /** What the invoice must still say, or the plan is stale. */
  expected: {
    status: string;
    subtotal_cents: number;
    total_cents: number;
    balance_due_cents: number;
    revision_number: number;
  };
  next: {
    subtotal_cents: number;
    discount_cents: number;
    diagnostic_credit_cents: number;
    tax_cents: number;
    total_cents: number;
    balance_due_cents: number;
    status: string;
    stripe_application_fee_cents: number;
    revision_number: number;
    /** Paid off by this revision: the invoice's paid time is set now. */
    paid_now: boolean;
  };
  subtotal_delta_cents: number;
  /** Paid more than the revised total: what the business owes back. */
  credit_due_cents: number;
  /** A fixed discount larger than the revised work, held to it. */
  discount_capped: boolean;
  /** The customer holds this invoice and the amount they owe changed: send them the updated one. */
  resend: boolean;
};

export type ApplyPlan = {
  lineInserts: LineInsert[];
  lineUpdates: LineUpdate[];
  lineDeletes: LineDelete[];
  /** Lines already on the job that this change order covers (swept-in additions). */
  coveredLineIds: string[];
  itemEffects: { item_id: string; effect: ItemEffect; billed_invoice_id: string | null; line_id: string | null }[];
  invoiceRevisions: InvoiceRevision[];
  /** Owed back to the customer: overpayments on revised invoices, and reductions on settled ones. */
  creditDueCents: number;
  /** New lines are waiting for a new invoice, because the newest one is settled. */
  needsSupplementalInvoice: boolean;
  /** Every invoice whose document should be laid out again. */
  touchedInvoiceIds: string[];
};

export type PlanResult = { ok: true; plan: ApplyPlan } | { ok: false; reason: string };

function whole(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

function worth(line: { quantity: number; unitPriceCents: number }): number {
  return lineTotalCents(line);
}

function feeOn(line: { quantity: number; unitPriceCents: number; adminFeeCents: number | null }): number {
  return lineAdminFee({ quantity: line.quantity, unitPriceCents: line.unitPriceCents, adminFeeCents: line.adminFeeCents });
}

function time(iso: string): number {
  const at = Date.parse(iso);
  return Number.isFinite(at) ? at : 0;
}

/**
 * The plan for one approved change order.
 *
 * `invoices` is every invoice on the job. `creditLeftCents` is how much of the
 * job's paid diagnostic fee no invoice has taken off yet, so a revision can
 * neither give it twice nor lose it. `newId` makes ids for new lines, so the
 * plan can say which invoice each one goes on before it exists.
 */
export function planChangeOrder(input: {
  changeOrderNumber: number;
  items: readonly PlanItem[];
  lines: readonly PlanLine[];
  invoices: readonly PlanInvoice[];
  creditLeftCents: number;
  newId: () => string;
}): PlanResult {
  const lines = new Map(input.lines.map((line) => [line.id, line]));
  const invoices = new Map(input.invoices.map((invoice) => [invoice.id, invoice]));
  const standingOf = (invoiceId: string | null): InvoiceStanding | "none" => {
    if (!invoiceId) return "none";
    const invoice = invoices.get(invoiceId);
    return invoice ? invoiceStanding(invoice) : "none";
  };

  const plan: ApplyPlan = {
    lineInserts: [],
    lineUpdates: [],
    lineDeletes: [],
    coveredLineIds: [],
    itemEffects: [],
    invoiceRevisions: [],
    creditDueCents: 0,
    needsSupplementalInvoice: false,
    touchedInvoiceIds: [],
  };
  const deltas = new Map<string, number>();
  const touched = new Set<string>();
  const addDelta = (invoiceId: string, cents: number) => {
    deltas.set(invoiceId, (deltas.get(invoiceId) ?? 0) + cents);
    touched.add(invoiceId);
  };
  // New lines, and what each is worth, waiting to be told which invoice they go on.
  const waiting: { insert: LineInsert; cents: number }[] = [];
  const label = `change order #${input.changeOrderNumber}`;

  for (const item of input.items) {
    if (item.action === "add") {
      if (item.existingLine) {
        // Already a line, billed the ordinary way. Approving only records that
        // the customer agreed to it.
        if (item.lineId && lines.has(item.lineId)) plan.coveredLineIds.push(item.lineId);
        plan.itemEffects.push({ item_id: item.id, effect: "none", billed_invoice_id: null, line_id: item.lineId });
        continue;
      }
      if (item.unitPriceCents === null) return { ok: false, reason: `"${item.description}" has no price.` };
      const insert: LineInsert = {
        id: input.newId(),
        item_id: item.id,
        kind: item.kind,
        description: item.description,
        quantity: item.quantity,
        unit: item.unit,
        unit_price_cents: whole(item.unitPriceCents),
        admin_fee_cents: Math.min(whole(item.unitPriceCents), Math.max(0, whole(item.adminFeeCents))),
        unit_cost_cents: item.unitCostCents ?? null,
        inventory_item_id: item.inventoryItemId ?? null,
        notes: item.notes?.trim() ? item.notes.trim() : null,
        invoice_id: null,
      };
      waiting.push({ insert, cents: worth({ quantity: item.quantity, unitPriceCents: whole(item.unitPriceCents) }) });
      continue;
    }

    const line = item.lineId ? lines.get(item.lineId) : undefined;
    if (!line) {
      return {
        ok: false,
        reason: `"${item.original?.description || item.description}" is no longer on the job, so this change order no longer matches it.`,
      };
    }
    if (!lineMatchesOriginal(line, item.original)) {
      return {
        ok: false,
        reason: `"${line.description}" has changed since this change order was written. Refresh the change order before it is applied.`,
      };
    }

    const before = worth(line);
    const expected = { quantity: line.quantity, unit_price_cents: whole(line.unitPriceCents), invoice_id: line.invoiceId };
    const standing = standingOf(line.invoiceId);

    if (item.action === "modify") {
      if (item.unitPriceCents === null) return { ok: false, reason: `"${item.description}" has no price.` };
      const changed = { quantity: item.quantity, unitPriceCents: whole(item.unitPriceCents), adminFeeCents: item.adminFeeCents };
      const delta = worth(changed) - before;

      if (standing === "settled") {
        // A paid line stays exactly as it was billed. The difference is billed
        // on its own, or owed back.
        if (delta > 0) {
          const feeDelta = Math.max(0, feeOn(changed) - feeOn(line));
          const insert: LineInsert = {
            id: input.newId(),
            item_id: item.id,
            kind: line.kind,
            description: `${item.description} (${label}: change to agreed work)`.slice(0, 300),
            quantity: 1,
            unit: "each",
            unit_price_cents: delta,
            admin_fee_cents: Math.min(delta, feeDelta),
            unit_cost_cents: null,
            inventory_item_id: null,
            notes: null,
            invoice_id: null,
          };
          waiting.push({ insert, cents: delta });
        } else if (delta < 0) {
          plan.creditDueCents += -delta;
          plan.itemEffects.push({ item_id: item.id, effect: "credit", billed_invoice_id: line.invoiceId, line_id: line.id });
        } else {
          plan.itemEffects.push({ item_id: item.id, effect: "none", billed_invoice_id: line.invoiceId, line_id: line.id });
        }
        continue;
      }

      plan.lineUpdates.push({
        id: line.id,
        item_id: item.id,
        expected,
        next: {
          description: item.description,
          quantity: item.quantity,
          unit: item.unit || line.unit,
          unit_price_cents: whole(item.unitPriceCents),
          admin_fee_cents: Math.min(whole(item.unitPriceCents), Math.max(0, whole(item.adminFeeCents))),
        },
      });
      if (standing === "draft" || standing === "revisable") {
        addDelta(line.invoiceId!, delta);
        plan.itemEffects.push({
          item_id: item.id,
          effect: standing === "draft" ? "draft" : "revision",
          billed_invoice_id: line.invoiceId,
          line_id: line.id,
        });
      } else {
        plan.itemEffects.push({ item_id: item.id, effect: "unbilled", billed_invoice_id: null, line_id: line.id });
      }
      continue;
    }

    // remove
    if (standing === "settled") {
      if (before > 0) plan.creditDueCents += before;
      plan.itemEffects.push({
        item_id: item.id,
        effect: before > 0 ? "credit" : "none",
        billed_invoice_id: line.invoiceId,
        line_id: line.id,
      });
      continue;
    }
    plan.lineDeletes.push({ id: line.id, item_id: item.id, expected });
    if (standing === "draft" || standing === "revisable") {
      addDelta(line.invoiceId!, -before);
      plan.itemEffects.push({
        item_id: item.id,
        effect: standing === "draft" ? "draft" : "revision",
        billed_invoice_id: line.invoiceId,
        line_id: null,
      });
    } else {
      plan.itemEffects.push({ item_id: item.id, effect: "unbilled", billed_invoice_id: null, line_id: null });
    }
  }

  // New lines go where the job's next billed line would: the newest live
  // invoice, if it can still move.
  if (waiting.length > 0) {
    const newest = [...input.invoices]
      .filter((invoice) => invoiceStanding(invoice) !== "void")
      .sort((a, b) => time(b.createdAt) - time(a.createdAt))[0];
    const standing = newest ? invoiceStanding(newest) : "none";
    for (const { insert, cents } of waiting) {
      if (newest && (standing === "draft" || standing === "revisable")) {
        insert.invoice_id = newest.id;
        addDelta(newest.id, cents);
        plan.itemEffects.push({
          item_id: insert.item_id,
          effect: standing === "draft" ? "draft" : "revision",
          billed_invoice_id: newest.id,
          line_id: insert.id,
        });
      } else {
        const supplemental = standing === "settled";
        if (supplemental) plan.needsSupplementalInvoice = true;
        plan.itemEffects.push({
          item_id: insert.item_id,
          effect: supplemental ? "supplemental" : "unbilled",
          billed_invoice_id: null,
          line_id: insert.id,
        });
      }
      plan.lineInserts.push(insert);
    }
  }

  // Each invoice that moves, recounted with the shared arithmetic.
  let creditLeft = Math.max(0, whole(input.creditLeftCents));
  for (const invoiceId of touched) {
    const invoice = invoices.get(invoiceId)!;
    const standing = invoiceStanding(invoice);
    if (standing !== "draft" && standing !== "revisable") continue;
    const delta = deltas.get(invoiceId) ?? 0;

    const subtotal = Math.max(0, whole(invoice.subtotalCents) + delta);
    const allowance = Math.max(0, whole(invoice.diagnosticCreditCents)) + creditLeft;
    const totals = invoiceTotals({
      subtotalCents: subtotal,
      discount: invoice.discount,
      taxCents: invoice.taxCents,
      diagnosticPaidCents: allowance,
    });
    creditLeft = Math.max(0, creditLeft - Math.max(0, totals.diagnosticCreditCents - whole(invoice.diagnosticCreditCents)));

    let balance = totals.totalCents;
    let status = invoice.status;
    let creditDue = 0;
    let paidNow = false;
    if (standing === "revisable") {
      // What the customer has already paid on it, however they paid. Kept: a
      // revision changes what the work costs, never what was handed over.
      const paidSoFar = Math.max(0, whole(invoice.totalCents) - whole(invoice.balanceDueCents));
      balance = Math.max(0, totals.totalCents - paidSoFar);
      creditDue = Math.max(0, paidSoFar - totals.totalCents);
      if (balance === 0 && paidSoFar > 0) {
        status = "paid";
        paidNow = true;
      } else if (paidSoFar > 0) {
        status = "partially_paid";
      }
    }
    plan.creditDueCents += creditDue;

    // Nothing about what the customer owes changed: nothing to send. Nor is a
    // bill sent for nothing — an invoice paid off by the revision says so on
    // the job instead.
    const resend = standing === "revisable" && totals.totalCents !== whole(invoice.totalCents) && balance > 0;

    plan.invoiceRevisions.push({
      invoice_id: invoice.id,
      invoice_number: invoice.number,
      standing,
      expected: {
        status: invoice.status,
        subtotal_cents: whole(invoice.subtotalCents),
        total_cents: whole(invoice.totalCents),
        balance_due_cents: whole(invoice.balanceDueCents),
        revision_number: whole(invoice.revisionNumber),
      },
      next: {
        subtotal_cents: totals.subtotalCents,
        discount_cents: totals.discountCents,
        diagnostic_credit_cents: totals.diagnosticCreditCents,
        tax_cents: totals.taxCents,
        total_cents: totals.totalCents,
        balance_due_cents: balance,
        status,
        stripe_application_fee_cents: totals.applicationFeeCents,
        revision_number: whole(invoice.revisionNumber) + 1,
        paid_now: paidNow,
      },
      subtotal_delta_cents: delta,
      credit_due_cents: creditDue,
      discount_capped: totals.discountCapped,
      resend,
    });
  }

  plan.touchedInvoiceIds = [...touched];
  return { ok: true, plan };
}
