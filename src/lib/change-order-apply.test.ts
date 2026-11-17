import assert from "node:assert/strict";
import { test } from "node:test";

import { invoiceStanding, planChangeOrder, type PlanInvoice, type PlanItem, type PlanLine } from "./change-order-apply.ts";
import { contractTotals } from "./change-order-math.ts";
import { invoiceTotals } from "./invoice-math.ts";

function ids() {
  let next = 0;
  return () => `new-${++next}`;
}

const outlets: PlanLine = {
  id: "outlets",
  kind: "labor",
  description: "Outlet installation",
  quantity: 1,
  unit: "each",
  unitPriceCents: 100_000,
  adminFeeCents: 0,
  invoiceId: null,
};
const lighting: PlanLine = { ...outlets, id: "lighting", description: "Lighting installation" };

function invoice(overrides: Partial<PlanInvoice>): PlanInvoice {
  return {
    id: "inv",
    number: "32",
    status: "draft",
    lastSentAt: null,
    paidAt: null,
    createdAt: "2026-11-01T00:00:00Z",
    subtotalCents: 200_000,
    taxCents: 0,
    diagnosticCreditCents: 0,
    totalCents: 200_000,
    balanceDueCents: 200_000,
    discount: null,
    stripeInvoiceId: null,
    revisionNumber: 0,
    paymentInFlight: false,
    ...overrides,
  };
}

function add(overrides: Partial<PlanItem>): PlanItem {
  return {
    id: "add",
    action: "add",
    kind: "material",
    description: "Materials",
    quantity: 1,
    unit: "each",
    unitPriceCents: 15_000,
    lineId: null,
    original: null,
    adminFeeCents: 0,
    ...overrides,
  };
}

function removal(line: PlanLine, overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: `remove-${line.id}`,
    action: "remove",
    kind: line.kind,
    description: line.description,
    quantity: line.quantity,
    unit: line.unit,
    unitPriceCents: null,
    lineId: line.id,
    original: { description: line.description, quantity: line.quantity, unit: line.unit, unitPriceCents: line.unitPriceCents },
    adminFeeCents: null,
    ...overrides,
  };
}

function change(line: PlanLine, next: { quantity?: number; unitPriceCents?: number }, overrides: Partial<PlanItem> = {}): PlanItem {
  return {
    id: `modify-${line.id}`,
    action: "modify",
    kind: line.kind,
    description: line.description,
    quantity: next.quantity ?? line.quantity,
    unit: line.unit,
    unitPriceCents: next.unitPriceCents ?? line.unitPriceCents,
    lineId: line.id,
    original: { description: line.description, quantity: line.quantity, unit: line.unit, unitPriceCents: line.unitPriceCents },
    adminFeeCents: 0,
    ...overrides,
  };
}

function plan(input: { items: PlanItem[]; lines?: PlanLine[]; invoices?: PlanInvoice[]; creditLeftCents?: number; number?: number }) {
  const result = planChangeOrder({
    changeOrderNumber: input.number ?? 1,
    items: input.items,
    lines: input.lines ?? [outlets, lighting],
    invoices: input.invoices ?? [],
    creditLeftCents: input.creditLeftCents ?? 0,
    newId: ids(),
  });
  assert.equal(result.ok, true, result.ok ? "" : result.reason);
  return (result as Extract<typeof result, { ok: true }>).plan;
}

test("invoice standing: drafts move, sent ones are revised, paid ones never move", () => {
  assert.equal(invoiceStanding(invoice({})), "draft");
  assert.equal(invoiceStanding(invoice({ status: "sent", lastSentAt: "x" })), "revisable");
  assert.equal(invoiceStanding(invoice({ status: "overdue", lastSentAt: "x" })), "revisable");
  assert.equal(invoiceStanding(invoice({ status: "partially_paid", lastSentAt: "x" })), "revisable");
  assert.equal(invoiceStanding(invoice({ status: "paid", paidAt: "x" })), "settled");
  assert.equal(invoiceStanding(invoice({ status: "sent", stripeInvoiceId: "in_1" })), "settled");
  assert.equal(invoiceStanding(invoice({ status: "sent", paymentInFlight: true })), "settled");
  assert.equal(invoiceStanding(invoice({ status: "void" })), "void");
});

test("no invoice yet: lines change and nothing is billed or sent", () => {
  const result = plan({ items: [add({ kind: "material", unitPriceCents: 15_000 }), removal(lighting)] });
  assert.equal(result.lineInserts.length, 1);
  assert.equal(result.lineInserts[0]!.invoice_id, null);
  assert.deepEqual(result.lineDeletes.map((entry) => entry.id), ["lighting"]);
  assert.equal(result.invoiceRevisions.length, 0);
  assert.equal(result.needsSupplementalInvoice, false);
  assert.deepEqual(result.itemEffects.map((effect) => effect.effect), ["unbilled", "unbilled"]);
});

test("a draft invoice follows quietly: recounted, never sent", () => {
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [invoice({})], items: [add({ unitPriceCents: 15_000 }), add({ id: "labor", kind: "labor", quantity: 2, unitPriceCents: 12_500 })] });
  assert.equal(result.lineInserts.every((line) => line.invoice_id === "inv"), true);
  const [revision] = result.invoiceRevisions;
  assert.equal(revision!.standing, "draft");
  assert.equal(revision!.next.subtotal_cents, 240_000);
  assert.equal(revision!.next.total_cents, 240_000);
  assert.equal(revision!.next.balance_due_cents, 240_000);
  assert.equal(revision!.resend, false);
});

test("a sent invoice is revised and resent, keeping the original figures as expected values", () => {
  const sent = invoice({ status: "sent", lastSentAt: "2026-11-02T00:00:00Z" });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [sent], items: [add({ unitPriceCents: 40_000 })] });
  const [revision] = result.invoiceRevisions;
  assert.equal(revision!.standing, "revisable");
  assert.deepEqual(revision!.expected, { status: "sent", subtotal_cents: 200_000, total_cents: 200_000, balance_due_cents: 200_000, revision_number: 0 });
  assert.equal(revision!.next.total_cents, 240_000);
  assert.equal(revision!.next.revision_number, 1);
  assert.equal(revision!.resend, true);
});

test("partial payments stay counted when a sent invoice is revised", () => {
  const partly = invoice({ status: "partially_paid", lastSentAt: "x", balanceDueCents: 150_000 });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [partly], items: [add({ unitPriceCents: 30_000 })] });
  const [revision] = result.invoiceRevisions;
  // $500 was paid; the revised total is $2,300, so $1,800 is still owed.
  assert.equal(revision!.next.total_cents, 230_000);
  assert.equal(revision!.next.balance_due_cents, 180_000);
  assert.equal(revision!.next.status, "partially_paid");
  assert.equal(revision!.credit_due_cents, 0);
});

test("a reduction below what was already paid pays the invoice off and surfaces a credit", () => {
  const partly = invoice({ status: "partially_paid", lastSentAt: "x", balanceDueCents: 50_000 });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  // $1,500 paid; removing $1,000 of lighting leaves a $1,000 invoice.
  const result = plan({ lines, invoices: [partly], items: [removal(lighting)] });
  const [revision] = result.invoiceRevisions;
  assert.equal(revision!.next.total_cents, 100_000);
  assert.equal(revision!.next.balance_due_cents, 0);
  assert.equal(revision!.next.status, "paid");
  assert.equal(revision!.next.paid_now, true);
  assert.equal(revision!.credit_due_cents, 50_000);
  assert.equal(result.creditDueCents, 50_000);
  // Nothing is owed, so no bill goes out; the credit is shown instead.
  assert.equal(revision!.resend, false);
});

test("a fully paid invoice never moves: more work goes on a new invoice", () => {
  const paid = invoice({ status: "paid", paidAt: "x", lastSentAt: "x", balanceDueCents: 0 });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [paid], items: [add({ unitPriceCents: 40_000 })] });
  assert.equal(result.invoiceRevisions.length, 0);
  assert.equal(result.lineInserts[0]!.invoice_id, null);
  assert.equal(result.needsSupplementalInvoice, true);
  assert.equal(result.itemEffects[0]!.effect, "supplemental");
});

test("a fully paid invoice never moves: less work is a credit owed, and the paid line stays", () => {
  const paid = invoice({ status: "paid", paidAt: "x", lastSentAt: "x", balanceDueCents: 0 });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [paid], items: [removal(lighting)] });
  assert.equal(result.lineDeletes.length, 0);
  assert.equal(result.creditDueCents, 100_000);
  assert.equal(result.itemEffects[0]!.effect, "credit");
});

test("a paid line made bigger is billed for the difference only", () => {
  const paid = invoice({ status: "paid", paidAt: "x", lastSentAt: "x", balanceDueCents: 0 });
  const fans: PlanLine = { ...outlets, id: "fans", description: "Ceiling fans", quantity: 2, unitPriceCents: 15_000, invoiceId: "inv" };
  const result = plan({ lines: [fans], invoices: [paid], items: [change(fans, { quantity: 3 })] });
  assert.equal(result.lineUpdates.length, 0);
  assert.equal(result.lineInserts.length, 1);
  assert.equal(result.lineInserts[0]!.unit_price_cents, 15_000);
  assert.equal(result.lineInserts[0]!.quantity, 1);
  assert.equal(result.needsSupplementalInvoice, true);
});

test("a voided invoice billed nothing: its lines change as unbilled lines", () => {
  const voided = invoice({ status: "void" });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [voided], items: [removal(lighting), add({ unitPriceCents: 1_000 })] });
  assert.equal(result.invoiceRevisions.length, 0);
  assert.equal(result.lineDeletes.length, 1);
  assert.equal(result.lineInserts[0]!.invoice_id, null);
  assert.equal(result.needsSupplementalInvoice, false);
});

test("a change made stale by an earlier change order is refused, not applied over it", () => {
  const fans: PlanLine = { ...outlets, id: "fans", quantity: 4, unitPriceCents: 15_000 };
  const stale: PlanItem = {
    ...change(fans, { quantity: 3 }),
    original: { description: fans.description, quantity: 2, unit: "each", unitPriceCents: 15_000 },
  };
  const result = planChangeOrder({ changeOrderNumber: 2, items: [stale], lines: [fans], invoices: [], creditLeftCents: 0, newId: ids() });
  assert.equal(result.ok, false);
  assert.match((result as { reason: string }).reason, /changed since/);
});

test("a line removed from the job since cannot be changed", () => {
  const result = planChangeOrder({ changeOrderNumber: 1, items: [removal(lighting)], lines: [outlets], invoices: [], creditLeftCents: 0, newId: ids() });
  assert.equal(result.ok, false);
});

test("a percentage discount on the invoice is recalculated on the revised subtotal", () => {
  const sent = invoice({ status: "sent", lastSentAt: "x", discount: { type: "percentage", basisPoints: 1000 }, totalCents: 180_000, balanceDueCents: 180_000 });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [sent], items: [add({ unitPriceCents: 50_000 })] });
  const [revision] = result.invoiceRevisions;
  assert.equal(revision!.next.subtotal_cents, 250_000);
  assert.equal(revision!.next.discount_cents, 25_000);
  assert.equal(revision!.next.total_cents, 225_000);
});

test("a fixed discount is kept on the revised subtotal, and capped when the work shrinks below it", () => {
  const fixed = { type: "fixed" as const, cents: 20_000 };
  const sent = invoice({ status: "sent", lastSentAt: "x", discount: fixed, totalCents: 180_000, balanceDueCents: 180_000 });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const more = plan({ lines, invoices: [sent], items: [add({ unitPriceCents: 50_000 })] }).invoiceRevisions[0]!;
  assert.equal(more.next.discount_cents, 20_000);
  assert.equal(more.next.total_cents, 230_000);

  const small = invoice({ status: "draft", subtotalCents: 25_000, totalCents: 5_000, balanceDueCents: 5_000, discount: fixed });
  const line: PlanLine = { ...outlets, unitPriceCents: 25_000, invoiceId: "inv" };
  const less = plan({ lines: [line], invoices: [small], items: [change(line, { unitPriceCents: 10_000 })] }).invoiceRevisions[0]!;
  assert.equal(less.next.discount_cents, 10_000);
  assert.equal(less.discount_capped, true);
  assert.equal(less.next.total_cents, 0);
});

test("a zero-dollar change order revises nothing a customer owes and sends nothing", () => {
  const sent = invoice({ status: "sent", lastSentAt: "x" });
  const lines = [{ ...outlets, invoiceId: "inv" }, { ...lighting, invoiceId: "inv" }];
  const result = plan({ lines, invoices: [sent], items: [add({ unitPriceCents: 0 })] });
  assert.equal(result.invoiceRevisions[0]!.next.total_cents, 200_000);
  assert.equal(result.invoiceRevisions[0]!.resend, false);
});

test("additions already on the job are covered, not added a second time", () => {
  const late: PlanLine = { ...outlets, id: "late", description: "Breaker added after signing", unitPriceCents: 5_000 };
  const swept = add({ id: "swept", existingLine: true, lineId: "late", description: late.description, unitPriceCents: 5_000 });
  const result = plan({ lines: [outlets, late], items: [swept] });
  assert.equal(result.lineInserts.length, 0);
  assert.deepEqual(result.coveredLineIds, ["late"]);
});

test("the diagnostic credit is not given twice when a revised invoice grows", () => {
  const sent = invoice({ status: "sent", lastSentAt: "x", subtotalCents: 5_000, diagnosticCreditCents: 5_000, totalCents: 0, balanceDueCents: 0 });
  const line: PlanLine = { ...outlets, unitPriceCents: 5_000, invoiceId: "inv" };
  // $100 fee, $50 of it already on this invoice, $50 still to come off.
  const result = plan({ lines: [line], invoices: [sent], creditLeftCents: 5_000, items: [add({ unitPriceCents: 20_000 })] });
  const [revision] = result.invoiceRevisions;
  assert.equal(revision!.next.diagnostic_credit_cents, 10_000);
  assert.equal(revision!.next.total_cents, 15_000);
});

/**
 * The end-to-end example: a $2,000 contract, a +$400 change order, a −$200
 * change order, and a 10% discount on the invoice.
 */
test("final verification: $2,000 + $400 − $200 = $2,200, less 10% = $1,980", () => {
  // Change order #1: $150 of materials and $250 of labor, before any invoice.
  const first = plan({
    number: 1,
    items: [
      add({ id: "materials", kind: "material", description: "Materials", unitPriceCents: 15_000 }),
      add({ id: "labor", kind: "labor", description: "Labor", quantity: 2, unitPriceCents: 12_500 }),
    ],
  });
  assert.equal(first.lineInserts.reduce((sum, line) => sum + line.unit_price_cents * line.quantity, 0), 40_000);

  // The invoice is raised from the lines as they now stand: $2,400.
  const lines: PlanLine[] = [
    { ...outlets, invoiceId: "inv" },
    { ...lighting, invoiceId: "inv" },
    ...first.lineInserts.map((line) => ({
      id: line.id,
      kind: line.kind,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit,
      unitPriceCents: line.unit_price_cents,
      adminFeeCents: 0,
      invoiceId: "inv",
    })),
  ];
  const draft = invoice({ subtotalCents: 240_000, totalCents: 240_000, balanceDueCents: 240_000 });

  // Change order #2: $200 of the lighting work comes out.
  const second = plan({ number: 2, lines, invoices: [draft], items: [change(lighting, { unitPriceCents: 80_000 }, { description: "Lighting installation (reduced)" })] });
  const revision = second.invoiceRevisions[0]!;
  assert.equal(revision.subtotal_delta_cents, -20_000);
  assert.equal(revision.next.subtotal_cents, 220_000);

  // The contract stands at $2,200 with both approved.
  const contract = contractTotals({
    agreement: { id: "agreement", totalCents: 200_000 },
    changeOrders: [
      { id: "1", number: 1, status: "approved", netCents: 40_000, approvalMethod: "customer_signature", baseContractId: "agreement" },
      { id: "2", number: 2, status: "approved", netCents: -20_000, approvalMethod: "customer_signature", baseContractId: "agreement" },
    ],
  });
  assert.equal(contract.committedCents, 220_000);

  // 10% off the invoice: −$220, $1,980 before tax.
  const discounted = invoiceTotals({ subtotalCents: revision.next.subtotal_cents, discount: { type: "percentage", basisPoints: 1000 } });
  assert.equal(discounted.discountCents, 22_000);
  assert.equal(discounted.totalCents, 198_000);

  // Taking the discount off restores $2,200 and there is no discount at all.
  const undiscounted = invoiceTotals({ subtotalCents: revision.next.subtotal_cents, discount: null });
  assert.equal(undiscounted.totalCents, 220_000);
  assert.equal(undiscounted.discountCents, 0);
});
