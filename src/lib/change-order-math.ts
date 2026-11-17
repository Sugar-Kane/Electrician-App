/**
 * Change orders: what each change is worth, what a change order comes to, and
 * what the contract now stands at.
 *
 * A change order adds work, changes work already agreed, or takes work out.
 * Only the difference is charged: three fans instead of two at $150 is +$150,
 * never $450 on top of the $300 already agreed. Taking out a $200 fan is −$200,
 * recorded as a removal — the line it removes is kept, as it was, on the item.
 *
 * Only approved change orders move the contract total. A draft, one waiting for
 * the customer, one the customer turned down, or one withdrawn changes nothing
 * the customer owes.
 *
 * All of it in integer cents, through the same `lineTotalCents` every job line
 * and invoice uses, so a change order and the invoice it lands on can never
 * disagree about what a line is worth. Import-free apart from that, so the
 * rules are tested without a database.
 */

import { lineTotalCents } from "./job-lines.ts";

export type ChangeOrderAction = "add" | "modify" | "remove";
export type ChangeOrderStatus = "draft" | "pending_approval" | "approved" | "rejected" | "canceled";
export type ChangeOrderKind = "labor" | "material";

export const CHANGE_ORDER_STATUSES: readonly ChangeOrderStatus[] = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "canceled",
];

export const STATUS_LABELS: Record<ChangeOrderStatus, string> = {
  draft: "Draft",
  pending_approval: "Pending customer approval",
  approved: "Approved",
  rejected: "Rejected",
  canceled: "Canceled",
};

/** A contract line as it stood when a change order was written against it. */
export type OriginalLine = {
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
};

export type ChangeOrderItem = {
  id: string;
  action: ChangeOrderAction;
  kind: ChangeOrderKind;
  /** What it is now: for an addition, the new work; for a change, the work as changed; for a removal, what is taken out. */
  description: string;
  quantity: number;
  unit: string;
  /**
   * The customer's price each, admin fee included, in cents. Null while nobody
   * has priced it: a change order can be started on site by somebody who may
   * not set prices, and is priced before the customer is asked.
   */
  unitPriceCents: number | null;
  /** The job line it changes or removes. For an addition, the line it became once approved. */
  lineId: string | null;
  /** That line as it was when this item was written. Set for changes and removals. */
  original: OriginalLine | null;
  /**
   * An addition already on the job: work written after the customer signed,
   * swept into this change order so the customer signs for it. It is already a
   * line, so approving adds nothing new.
   */
  existingLine?: boolean;
  notes?: string;
};

function whole(value: number | null | undefined): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(value);
}

function lineWorth(line: { quantity: number; unitPriceCents: number | null } | null | undefined): number {
  if (!line || line.unitPriceCents === null) return 0;
  return lineTotalCents({ quantity: line.quantity, unitPriceCents: line.unitPriceCents });
}

/** Whether an item still needs a price before the customer can be asked. Removals are priced by what they remove. */
export function itemNeedsPrice(item: Pick<ChangeOrderItem, "action" | "unitPriceCents">): boolean {
  return item.action !== "remove" && item.unitPriceCents === null;
}

/**
 * What one change adds to or takes off the contract, in cents.
 *
 * - add: the new line's worth.
 * - modify: the line as changed, less the line as it was — the net difference.
 * - remove: minus the line as it was.
 *
 * An unpriced addition or change is worth nothing yet, and is reported as
 * unpriced rather than guessed.
 */
export function itemNetCents(item: Pick<ChangeOrderItem, "action" | "quantity" | "unitPriceCents" | "original">): number {
  if (item.action === "add") return lineWorth(item);
  if (item.action === "remove") return -lineWorth(item.original);
  if (item.unitPriceCents === null) return 0;
  return lineWorth(item) - lineWorth(item.original);
}

export type ChangeOrderSummary = {
  /** New parts, at their price. */
  addedMaterialsCents: number;
  /** New labor, at its rate. */
  addedLaborCents: number;
  /** What changed lines come to, net: positive when a change costs more. */
  modifiedCents: number;
  /** What removed lines were worth, as a negative number. */
  removedCents: number;
  /** All of it together: what this change order adds to (or takes off) the contract. */
  netCents: number;
  itemCount: number;
  /** Additions and changes nobody has priced yet. */
  unpricedCount: number;
};

/** What a change order comes to, split the way a customer asks about it. */
export function changeOrderSummary(items: readonly ChangeOrderItem[]): ChangeOrderSummary {
  let addedMaterialsCents = 0;
  let addedLaborCents = 0;
  let modifiedCents = 0;
  let removedCents = 0;
  let unpricedCount = 0;

  for (const item of items) {
    if (itemNeedsPrice(item)) unpricedCount += 1;
    const net = itemNetCents(item);
    if (item.action === "add") {
      if (item.kind === "labor") addedLaborCents += net;
      else addedMaterialsCents += net;
    } else if (item.action === "modify") modifiedCents += net;
    else removedCents += net;
  }

  return {
    addedMaterialsCents,
    addedLaborCents,
    modifiedCents,
    removedCents,
    netCents: addedMaterialsCents + addedLaborCents + modifiedCents + removedCents,
    itemCount: items.length,
    unpricedCount,
  };
}

/** A change order as far as the contract total is concerned. */
export type ChangeOrderStanding = {
  id: string;
  number: number;
  status: ChangeOrderStatus;
  netCents: number;
  /** How it was agreed: signed by the customer, or folded into a revised unsigned contract. */
  approvalMethod: "customer_signature" | "contract_revision" | null;
  /** The agreement it amends. */
  baseContractId: string | null;
};

export type ContractTotals = {
  /** What the agreement states, or null when it was drawn up before contracts recorded a figure. */
  originalCents: number | null;
  /** Approved change orders, oldest first, with what each adds. */
  approved: { id: string; number: number; netCents: number }[];
  approvedNetCents: number;
  /** Waiting for the customer: shown, never counted. */
  pendingNetCents: number;
  /** The agreement plus everything approved since. Null when the agreement's figure is unknown. */
  committedCents: number | null;
};

/**
 * What the contract stands at: the agreement, plus every change order the
 * customer has approved against it.
 *
 * Only change orders against this agreement count. One folded into a revised
 * draft (an unsigned contract updated instead) is already inside the newer
 * agreement's figure, and counting it again would charge for it twice. A
 * signed change order from before structured change orders existed has only
 * its document; `legacyApprovedCents` is what those added.
 */
export function contractTotals(input: {
  agreement: { id: string; totalCents: number | null } | null;
  changeOrders: readonly ChangeOrderStanding[];
  legacyApprovedCents?: number;
}): ContractTotals {
  const agreementId = input.agreement?.id ?? null;
  const against = input.changeOrders.filter(
    (order) => order.approvalMethod !== "contract_revision" && (!agreementId || order.baseContractId === agreementId),
  );
  const approved = against
    .filter((order) => order.status === "approved")
    .sort((a, b) => a.number - b.number)
    .map((order) => ({ id: order.id, number: order.number, netCents: whole(order.netCents) }));
  const approvedNetCents = approved.reduce((sum, order) => sum + order.netCents, 0) + whole(input.legacyApprovedCents);
  const pendingNetCents = against
    .filter((order) => order.status === "pending_approval")
    .reduce((sum, order) => sum + whole(order.netCents), 0);
  const originalCents =
    input.agreement && typeof input.agreement.totalCents === "number" ? whole(input.agreement.totalCents) : null;

  return {
    originalCents,
    approved,
    approvedNetCents,
    pendingNetCents,
    committedCents: originalCents === null ? null : originalCents + approvedNetCents,
  };
}

/** Only a draft can be edited. Once the customer has been asked, what they were asked stays fixed. */
export function canEditChangeOrder(status: string): boolean {
  return status === "draft";
}

/** A draft or one waiting for the customer can be withdrawn. An answered one is history. */
export function canCancelChangeOrder(status: string): boolean {
  return status === "draft" || status === "pending_approval";
}

/**
 * Why the items cannot go to the customer yet, or "" when they can.
 *
 * Every addition and change priced, at least one item, no line changed twice
 * in one change order, and no change that changes nothing.
 */
export function itemsNotReadyBecause(items: readonly ChangeOrderItem[]): string {
  if (items.length === 0) return "Add at least one change: new work, a change to agreed work, or work taken out.";
  const unpriced = items.filter(itemNeedsPrice);
  if (unpriced.length > 0) {
    return `${unpriced.length} ${unpriced.length === 1 ? "item needs" : "items need"} a price before the customer can be asked: ${unpriced
      .map((item) => item.description)
      .slice(0, 3)
      .join(", ")}.`;
  }
  const touched = new Set<string>();
  for (const item of items) {
    if (item.action === "add" || !item.lineId) continue;
    if (touched.has(item.lineId)) return `"${item.description}" is changed more than once in this change order. Keep one.`;
    touched.add(item.lineId);
  }
  for (const item of items) {
    if (item.action !== "modify" || !item.original) continue;
    const same =
      item.quantity === item.original.quantity &&
      item.unitPriceCents === item.original.unitPriceCents &&
      item.description.trim() === item.original.description.trim();
    if (same) return `"${item.description}" is listed as changed but nothing about it changed.`;
  }
  return "";
}

/**
 * Whether a line still matches what a change order was written against.
 *
 * A change order approved by the customer says "2 fans become 3". If somebody
 * changed that line to 4 in the meantime (another change order, or an edit on
 * the job), applying "becomes 3" would undo their change behind their back, so
 * the change order has to be refreshed first.
 */
export function lineMatchesOriginal(
  line: { quantity: number; unitPriceCents: number } | null | undefined,
  original: OriginalLine | null | undefined,
): boolean {
  if (!line || !original) return false;
  return (
    Math.round(line.quantity * 1000) === Math.round(original.quantity * 1000) &&
    whole(line.unitPriceCents) === whole(original.unitPriceCents)
  );
}

/** "+$150.00", "−$200.00" or "$0.00": an adjustment, signed, as it is printed. */
export function signedCents(cents: number, format: (cents: number) => string): string {
  const value = whole(cents);
  if (value > 0) return `+${format(value)}`;
  if (value < 0) return `−${format(-value)}`;
  return format(0);
}
