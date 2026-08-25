import test from "node:test";
import assert from "node:assert/strict";

import {
  checkReceiptTotals,
  describeReceiptPlan,
  linesTotalCents,
  matchReceiptLine,
  planReceipt,
  readReceiptLine,
  TAX_HEADROOM,
  type ReceiptLine,
} from "./receipt-lines.ts";
import type { StockItem } from "./inventory-match.ts";

const stock: StockItem[] = [
  { id: "brk", name: "20 amp AFCI breaker", quantity: 12, unit: "each", partNumber: "HOM120AFIC" },
  { id: "wire", name: "12/2 Romex", quantity: 250, unit: "ft", partNumber: "" },
  { id: "box", name: "Single gang old work box", quantity: 3, unit: "each", partNumber: "B114R" },
];

function line(over: Partial<ReceiptLine> = {}): ReceiptLine {
  return {
    name: "20A AFCI breaker",
    quantity: 4,
    unit: "each",
    unitCostCents: 4200,
    partNumber: "",
    ...over,
  };
}

test("a line with no name is not a line", () => {
  // The model finding a shop's phone number on the page and calling it a part.
  assert.equal(readReceiptLine({ name: "   ", quantity: 2 }), null);
  assert.equal(readReceiptLine(null), null);
  assert.equal(readReceiptLine("20A breaker"), null);
});

test("an unreadable figure falls back to something visible, never to a guess", () => {
  const read = readReceiptLine({ name: "Wire nuts", quantity: "smudged", unit_cost_cents: "???" });

  // 1 rather than 0: a receipt line is at least one of something, and a
  // quantity of 0 would save a movement that does nothing.
  assert.equal(read?.quantity, 1);
  // 0 rather than a plausible-looking number. It shows as an empty cost box.
  assert.equal(read?.unitCostCents, 0);
  assert.equal(read?.unit, "each");
});

test("a credit line never reads as a negative purchase", () => {
  const read = readReceiptLine({ name: "Returned breaker", quantity: -2, unit_cost_cents: -4200 });

  assert.equal(read?.quantity, 1);
  assert.equal(read?.unitCostCents, 0);
});

test("the lines add up in cents, not in floating dollars", () => {
  const total = linesTotalCents([
    { quantity: 3, unitCostCents: 1999 },
    { quantity: 2.5, unitCostCents: 145 },
  ]);

  assert.equal(total, 5997 + 363);
});

test("sales tax on top of the parts is not a discrepancy", () => {
  // $100 of parts, 8.75% tax. Ordinary, and worth no warning at all.
  const check = checkReceiptTotals(10_000, 10_875);

  assert.equal(check.worthChecking, false);
  assert.match(check.message, /\$100\.00 of parts/);
  assert.match(check.message, /\$108\.75 with tax/);
});

test("parts adding up to more than the receipt is the misread quantity", () => {
  // The failure this exists for: 12 read where the paper says 2.
  const check = checkReceiptTotals(25_200, 9_150);

  assert.equal(check.worthChecking, true);
  assert.match(check.message, /more than the \$91\.50/);
});

test("a total stranded far above the parts is a line that was missed", () => {
  const check = checkReceiptTotals(4_000, 20_000);

  assert.equal(check.worthChecking, true);
  assert.match(check.message, /may not have been read/);
});

test("nothing to compare against says nothing", () => {
  assert.equal(checkReceiptTotals(5_000, 0).message, "");
  assert.equal(checkReceiptTotals(0, 5_000).message, "");
  assert.equal(checkReceiptTotals(5_000, 0).worthChecking, false);
});

test("the tax band is wider than the worst California district rate", () => {
  // 10.75% exists in real California cities. A headroom under it would warn on
  // every honest receipt bought there, which is the fastest way to teach
  // somebody to ignore the warning.
  assert.ok(TAX_HEADROOM > 0.1075);
});

test("a printed part number settles the match", () => {
  // The receipt calls it something else entirely; the SKU is the identity.
  const match = matchReceiptLine(
    line({ name: "BREAKER AFCI 1P 20A", partNumber: "HOM120AFIC" }),
    stock,
  );

  assert.equal(match?.id, "brk");
});

test("a part the business has never stocked matches nothing", () => {
  assert.equal(matchReceiptLine(line({ name: "Fish tape 25ft" }), stock), undefined);
});

test("what is bought is counted in the unit the shelf is counted in", () => {
  // 250 ft of Romex on the shelf and a receipt that says one "roll". Adding 1
  // to 250 ft is wrong, and there is no conversion to invent — so the row is
  // saved in feet with the receipt's word kept beside it for the person to fix.
  const [plan] = planReceipt([line({ name: "12/2 Romex", quantity: 1, unit: "roll" })], stock);

  assert.equal(plan?.matchId, "wire");
  assert.equal(plan?.unit, "ft");
  assert.equal(plan?.receiptUnit, "roll");
  assert.equal(plan?.onHand, 250);
});

test("units that agree leave nothing to say", () => {
  const [plan] = planReceipt([line({ partNumber: "HOM120AFIC" })], stock);

  assert.equal(plan?.matchId, "brk");
  assert.equal(plan?.receiptUnit, "");
});

test("an unmatched line carries no stock row to move", () => {
  const [plan] = planReceipt([line({ name: "Fish tape 25ft" })], stock);

  assert.equal(plan?.matchId, "");
  assert.equal(plan?.matchName, "");
  assert.equal(plan?.onHand, 0);
});

test("the summary counts what is already stocked separately from what is new", () => {
  const plan = planReceipt(
    [
      line({ partNumber: "HOM120AFIC" }),
      line({ name: "12/2 Romex", unit: "ft" }),
      line({ name: "Fish tape 25ft" }),
    ],
    stock,
  );

  assert.equal(describeReceiptPlan(plan), "2 you already stock, 1 new to the list.");
  assert.equal(describeReceiptPlan(plan.slice(0, 1)), "1 part you already stock.");
  assert.equal(describeReceiptPlan(plan.slice(2)), "1 part new to your stock list.");
  assert.equal(describeReceiptPlan([]), "Nothing on this receipt could be read as a part.");
});
