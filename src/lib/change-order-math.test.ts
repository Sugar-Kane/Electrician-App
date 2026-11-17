import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canCancelChangeOrder,
  canEditChangeOrder,
  changeOrderSummary,
  contractTotals,
  itemNetCents,
  itemsNotReadyBecause,
  lineMatchesOriginal,
  type ChangeOrderItem,
  type ChangeOrderStanding,
} from "./change-order-math.ts";

function item(overrides: Partial<ChangeOrderItem>): ChangeOrderItem {
  return {
    id: "item",
    action: "add",
    kind: "material",
    description: "Outlet",
    quantity: 1,
    unit: "each",
    unitPriceCents: 0,
    lineId: null,
    original: null,
    ...overrides,
  };
}

const fans = { description: "Install ceiling fan", quantity: 2, unit: "each", unitPriceCents: 15_000 };

test("an addition is worth its line", () => {
  assert.equal(itemNetCents(item({ quantity: 2, unitPriceCents: 7_500 })), 15_000);
  assert.equal(itemNetCents(item({ kind: "labor", quantity: 2, unitPriceCents: 12_500 })), 25_000);
});

test("a change charges only the difference, never the whole replacement on top", () => {
  // Two fans at $150 become three: +$150, not +$450.
  const change = item({ action: "modify", lineId: "fan", original: fans, description: fans.description, quantity: 3, unitPriceCents: 15_000 });
  assert.equal(itemNetCents(change), 15_000);
});

test("a change can make the contract cheaper", () => {
  const cheaper = item({ action: "modify", lineId: "fan", original: fans, description: fans.description, quantity: 2, unitPriceCents: 12_000 });
  assert.equal(itemNetCents(cheaper), -6_000);
});

test("a removal takes off what the line was worth", () => {
  const removal = item({ action: "remove", lineId: "fan", original: { ...fans, quantity: 1, unitPriceCents: 20_000 }, description: fans.description });
  assert.equal(itemNetCents(removal), -20_000);
});

test("an unpriced addition is worth nothing yet and is counted as unpriced", () => {
  const summary = changeOrderSummary([item({ unitPriceCents: null }), item({ id: "b", unitPriceCents: 1_000 })]);
  assert.equal(summary.netCents, 1_000);
  assert.equal(summary.unpricedCount, 1);
});

test("the summary splits materials, labor, changes and removals, and they add up", () => {
  const summary = changeOrderSummary([
    item({ id: "1", kind: "material", quantity: 1, unitPriceCents: 15_000 }),
    item({ id: "2", kind: "labor", quantity: 2, unitPriceCents: 12_500 }),
    item({ id: "3", action: "remove", lineId: "x", original: { description: "Old", quantity: 1, unit: "each", unitPriceCents: 10_000 } }),
    item({ id: "4", action: "modify", lineId: "fan", original: fans, description: fans.description, quantity: 3, unitPriceCents: 15_000 }),
  ]);
  assert.equal(summary.addedMaterialsCents, 15_000);
  assert.equal(summary.addedLaborCents, 25_000);
  assert.equal(summary.removedCents, -10_000);
  assert.equal(summary.modifiedCents, 15_000);
  assert.equal(summary.netCents, 45_000);
});

test("a zero-dollar change order is allowed and nets to zero", () => {
  const summary = changeOrderSummary([item({ unitPriceCents: 0 })]);
  assert.equal(summary.netCents, 0);
  assert.equal(itemsNotReadyBecause([item({ unitPriceCents: 0 })]), "");
});

function order(overrides: Partial<ChangeOrderStanding>): ChangeOrderStanding {
  return {
    id: "co",
    number: 1,
    status: "approved",
    netCents: 0,
    approvalMethod: "customer_signature",
    baseContractId: "agreement",
    ...overrides,
  };
}

test("only approved change orders move the contract total", () => {
  const totals = contractTotals({
    agreement: { id: "agreement", totalCents: 200_000 },
    changeOrders: [
      order({ id: "1", number: 1, netCents: 30_000 }),
      order({ id: "2", number: 2, netCents: -10_000 }),
      order({ id: "3", number: 3, netCents: 25_000 }),
      order({ id: "4", number: 4, netCents: 99_000, status: "draft" }),
      order({ id: "5", number: 5, netCents: 99_000, status: "pending_approval" }),
      order({ id: "6", number: 6, netCents: 99_000, status: "rejected" }),
      order({ id: "7", number: 7, netCents: 99_000, status: "canceled" }),
    ],
  });
  assert.equal(totals.committedCents, 245_000);
  assert.equal(totals.approvedNetCents, 45_000);
  assert.equal(totals.pendingNetCents, 99_000);
  assert.deepEqual(totals.approved.map((entry) => entry.number), [1, 2, 3]);
});

test("a change folded into a revised unsigned contract is not counted a second time", () => {
  const totals = contractTotals({
    agreement: { id: "new-draft", totalCents: 230_000 },
    changeOrders: [order({ netCents: 30_000, approvalMethod: "contract_revision", baseContractId: "old-draft" })],
  });
  assert.equal(totals.committedCents, 230_000);
});

test("change orders against an older agreement do not count against a newer one", () => {
  const totals = contractTotals({
    agreement: { id: "agreement-2", totalCents: 100_000 },
    changeOrders: [order({ netCents: 30_000, baseContractId: "agreement-1" })],
  });
  assert.equal(totals.committedCents, 100_000);
});

test("signed change orders from before this feature still count", () => {
  const totals = contractTotals({ agreement: { id: "a", totalCents: 100_000 }, changeOrders: [], legacyApprovedCents: 12_000 });
  assert.equal(totals.committedCents, 112_000);
});

test("an agreement with no recorded figure has an unknown total, not a guessed one", () => {
  const totals = contractTotals({ agreement: { id: "a", totalCents: null }, changeOrders: [order({ baseContractId: "a", netCents: 5_000 })] });
  assert.equal(totals.committedCents, null);
  assert.equal(totals.approvedNetCents, 5_000);
});

test("only a draft is edited; drafts and pending ones can be withdrawn; answered ones are history", () => {
  assert.equal(canEditChangeOrder("draft"), true);
  for (const status of ["pending_approval", "approved", "rejected", "canceled"]) assert.equal(canEditChangeOrder(status), false);
  assert.equal(canCancelChangeOrder("draft"), true);
  assert.equal(canCancelChangeOrder("pending_approval"), true);
  for (const status of ["approved", "rejected", "canceled"]) assert.equal(canCancelChangeOrder(status), false);
});

test("a change order is not sent to the customer empty, unpriced, contradictory or pointless", () => {
  assert.match(itemsNotReadyBecause([]), /at least one/);
  assert.match(itemsNotReadyBecause([item({ unitPriceCents: null })]), /needs a price/);
  const twice = [
    item({ id: "a", action: "remove", lineId: "fan", original: fans }),
    item({ id: "b", action: "modify", lineId: "fan", original: fans, quantity: 3, unitPriceCents: 15_000 }),
  ];
  assert.match(itemsNotReadyBecause(twice), /more than once/);
  const unchanged = item({ action: "modify", lineId: "fan", original: fans, description: fans.description, quantity: 2, unitPriceCents: 15_000 });
  assert.match(itemsNotReadyBecause([unchanged]), /nothing about it changed/);
  // A removal needs no price: it is priced by what it removes.
  assert.equal(itemsNotReadyBecause([item({ action: "remove", lineId: "fan", original: fans, unitPriceCents: null })]), "");
});

test("a line edited since the change order was written no longer matches it", () => {
  assert.equal(lineMatchesOriginal({ quantity: 2, unitPriceCents: 15_000 }, fans), true);
  assert.equal(lineMatchesOriginal({ quantity: 4, unitPriceCents: 15_000 }, fans), false);
  assert.equal(lineMatchesOriginal({ quantity: 2, unitPriceCents: 14_000 }, fans), false);
  assert.equal(lineMatchesOriginal(null, fans), false);
});
