import assert from "node:assert/strict";
import { test } from "node:test";

import { changeOrderSummary, type ChangeOrderItem } from "./change-order-math.ts";
import { invoiceJson, requestKey, runChangeOrderTool, type ChangeOrderServices, type ChangeOrderToolContext } from "./mcp-change-order-tools.ts";

/*
 * ChatGPT's change order and discount tools, with the database replaced by
 * recorders. What matters: it cannot set prices or discounts without billing
 * permission, cannot approve anything, asks before preparing a change order
 * or changing a discount, refuses unreadable input before it reaches the
 * database, and a retried request is recognised as the same request.
 */

const ORDER_ID = "11111111-1111-4111-8111-111111111111";
const LINE_ID = "22222222-2222-4222-8222-222222222222";
const ITEM_ID = "33333333-3333-4333-8333-333333333333";
const INVOICE_ID = "44444444-4444-4444-8444-444444444444";

function order(overrides: Record<string, unknown> = {}, items: ChangeOrderItem[] = []) {
  const summary = changeOrderSummary(items);
  return {
    id: ORDER_ID,
    number: 1,
    description: "Two more outlets",
    reason: "",
    status: "draft",
    statusLabel: "Draft",
    approvalMethod: null,
    netCents: summary.netCents,
    originalContractCents: null,
    baseContractId: "agreement",
    documentContractId: null,
    createdAt: "2026-11-17T00:00:00Z",
    requestedAt: null,
    approvedAt: null,
    approvedByName: "",
    rejectedAt: null,
    rejectionReason: "",
    canceledAt: null,
    appliedAt: null,
    creditDueCents: 0,
    version: 1,
    items: items.map((item) => ({ ...item, adminFeeCents: 0, unitCostCents: null, inventoryItemId: null, netCents: 0, appliedEffect: null, billedInvoiceId: null })),
    summary,
    resends: [],
    jobId: "job",
    jobNumber: "32",
    ...overrides,
  } as never;
}

function job(overrides: Record<string, unknown> = {}) {
  return {
    jobId: "job",
    jobNumber: "32",
    adminFeeBps: 0,
    agreement: { id: "agreement", status: "signed", signed: true, signedAt: "2026-11-01T00:00:00Z", totalCents: 200_000 },
    totals: { originalCents: 200_000, approved: [{ id: "a", number: 1, netCents: 40_000 }], approvedNetCents: 40_000, pendingNetCents: 10_000, committedCents: 240_000 },
    changeOrders: [order({ status: "approved", statusLabel: "Approved", netCents: 40_000, approvalMethod: "customer_signature" })],
    lines: [{ id: LINE_ID, kind: "labor", description: "Install ceiling fan", quantity: 2, unit: "each", unitPriceCents: 15_000, adminFeeCents: 0, invoiceId: null, billedNote: "" }],
    laborRates: [],
    ...overrides,
  } as never;
}

function summary(overrides: Record<string, unknown> = {}) {
  return {
    invoiceId: INVOICE_ID,
    invoiceNumber: "32",
    jobNumber: "32",
    status: "sent",
    originalSubtotalCents: 200_000,
    changeOrders: [],
    changeOrderCents: 0,
    subtotalCents: 200_000,
    discount: null,
    discountLabel: "",
    discountCents: 0,
    discountCapped: false,
    discountReason: "",
    diagnosticCreditCents: 0,
    taxCents: 0,
    totalCents: 200_000,
    paidCents: 0,
    balanceDueCents: 200_000,
    revisionNumber: 0,
    changedSinceSent: false,
    lastSentAt: null,
    ...overrides,
  } as never;
}

function harness(options: { billing?: boolean; order?: unknown; job?: unknown; invoice?: unknown; duplicate?: boolean } = {}) {
  const calls: { name: string; args: unknown[] }[] = [];
  const record = (name: string) => (...args: unknown[]) => {
    calls.push({ name, args });
  };
  const services: ChangeOrderServices = {
    loadJob: async (...args) => (record("loadJob")(...args), (options.job ?? job()) as never),
    loadOrder: async (id) => (record("loadOrder")(id), (id === ORDER_ID ? options.order ?? order() : null) as never),
    create: async (input) => (record("create")(input), { ok: true, changeOrderId: ORDER_ID, number: 2, jobNumber: input.jobNumber, swept: 0 }),
    // The server answers a repeated request key with the item it already has.
    addItem: async (id, item) => (record("addItem")(id, item), { ok: true, itemId: ITEM_ID, duplicate: options.duplicate === true }),
    update: async (id, input) => (record("update")(id, input), { ok: true }),
    removeItem: async (id, item) => (record("removeItem")(id, item), { ok: true }),
    requestApproval: async (id) => (record("requestApproval")(id), { ok: true, contractId: "doc", netCents: 30_000, revisedCents: 270_000, jobNumber: "32", pdfError: "" }),
    findInvoice: async (input) => (record("findInvoice")(input), { invoiceId: INVOICE_ID }),
    invoiceSummary: async (id) => (record("invoiceSummary")(id), (options.invoice ?? summary()) as never),
    setDiscount: async (id, input) => (record("setDiscount")(id, input), { ok: true, summary: summary({ discountCents: 20_000, totalCents: 180_000 }), revised: true, message: "Discount (10%) applied" }),
  };
  const context: ChangeOrderToolContext = { canEditBilling: options.billing ?? true, services };
  const run = (name: string, args: Record<string, unknown>) => runChangeOrderTool({ name, args, context });
  const called = (name: string) => calls.filter((call) => call.name === name);
  return { run, called };
}

test("listing a job's change orders gives the contract total with only approved ones, and the item ids", async () => {
  const { run } = harness();
  const result = await run("list_job_change_orders", { job_number: "#32" });
  assert.equal(result.isError, undefined);
  assert.equal(result.structured?.contract_total_cents, 240_000);
  assert.equal(result.structured?.pending_change_orders_cents, 10_000);
  assert.match(result.text, /Contract total including approved change orders: \$2,400\.00/);
  assert.deepEqual((result.structured?.contract_items as { id: string }[]).map((item) => item.id), [LINE_ID]);
});

test("unreadable input is refused before anything reaches the database", async () => {
  const { run, called } = harness();
  assert.equal((await run("list_job_change_orders", { job_number: "thirty" })).structured?.error, "invalid_job_number");
  assert.equal((await run("create_change_order", { job_number: "32", description: "" })).structured?.error, "missing_description");
  assert.equal((await run("get_change_order", { change_order_id: "not-an-id" })).structured?.error, "invalid_change_order_id");
  assert.equal((await run("add_change_order_material", { change_order_id: ORDER_ID, quantity: 2 })).structured?.error, "missing_description");
  assert.equal((await run("add_change_order_labor", { change_order_id: ORDER_ID, description: "Troubleshoot" })).structured?.error, "missing_hours");
  assert.equal((await run("modify_change_order_item", { change_order_id: ORDER_ID, original_contract_item_id: "x", quantity: 3 })).structured?.error, "invalid_item_id");
  assert.equal((await run("modify_change_order_item", { change_order_id: ORDER_ID, original_contract_item_id: LINE_ID })).structured?.error, "nothing_to_change");
  assert.equal(called("addItem").length + called("create").length, 0);
});

test("a change order in another business is not found", async () => {
  const { run } = harness();
  const result = await run("get_change_order", { change_order_id: "99999999-9999-4999-8999-999999999999" });
  assert.equal(result.structured?.error, "not_found");
});

test("creating a change order makes a draft and says nothing changes until the customer signs", async () => {
  const { run, called } = harness();
  const result = await run("create_change_order", { job_number: "32", description: "Customer wants two more outlets" });
  assert.equal(result.structured?.status, "draft");
  assert.equal(called("create").length, 1);
  assert.match(result.text, /until they sign/);
});

test("materials and labor go to the server as typed, with a request key", async () => {
  const { run, called } = harness();
  await run("add_change_order_material", { change_order_id: ORDER_ID, description: "12/2 Romex", quantity: 50, unit: "ft", unit_price: "$0.85" });
  await run("add_change_order_labor", { change_order_id: ORDER_ID, description: "Run new circuit", hours: 3, hourly_rate: 125 });
  const [material, labor] = called("addItem").map((call) => call.args[1] as Record<string, unknown>);
  assert.equal(material!.kind, "material");
  assert.equal(material!.quantity, "50");
  assert.equal(material!.unitPrice, "0.85");
  assert.match(String(material!.requestKey), /^auto:/);
  assert.equal(labor!.kind, "labor");
  assert.equal(labor!.quantity, "3");
  assert.equal(labor!.unitPrice, "125");
});

test("modifications and removals name the job item they change", async () => {
  const { run, called } = harness();
  await run("modify_change_order_item", { change_order_id: ORDER_ID, original_contract_item_id: LINE_ID, quantity: 3 });
  await run("remove_change_order_item", { change_order_id: ORDER_ID, original_contract_item_id: LINE_ID, reason: "Customer changed their mind" });
  const [modify, remove] = called("addItem").map((call) => call.args[1] as Record<string, unknown>);
  assert.equal(modify!.action, "modify");
  assert.equal(modify!.lineId, LINE_ID);
  assert.equal(remove!.action, "remove");
  assert.equal(remove!.notes, "Customer changed their mind");
});

test("without billing permission no price can be set, but unpriced changes can still be written down", async () => {
  const { run, called } = harness({ billing: false });
  const priced = await run("add_change_order_labor", { change_order_id: ORDER_ID, description: "Troubleshoot", hours: 2, hourly_rate: 125 });
  assert.equal(priced.structured?.error, "forbidden_price");
  const unpriced = await run("add_change_order_labor", { change_order_id: ORDER_ID, description: "Troubleshoot", hours: 2 });
  assert.equal(unpriced.isError, undefined);
  assert.equal(called("addItem").length, 1);
  assert.equal((await run("set_invoice_discount", { job_number: "32", discount_type: "percentage", discount_value: 10, confirmed: true })).structured?.error, "forbidden");
  assert.equal((await run("request_change_order_approval", { change_order_id: ORDER_ID, confirmed: true })).structured?.error, "forbidden");
  assert.equal(called("setDiscount").length + called("requestApproval").length, 0);
});

test("a retried request carries the same key; a different request does not", () => {
  const first = requestKey("add_change_order_labor", { change_order_id: ORDER_ID, description: "Troubleshoot", hours: 2, hourly_rate: 125 });
  const retried = requestKey("add_change_order_labor", { hourly_rate: 125, hours: 2, description: "Troubleshoot", change_order_id: ORDER_ID });
  const different = requestKey("add_change_order_labor", { change_order_id: ORDER_ID, description: "Troubleshoot", hours: 3, hourly_rate: 125 });
  assert.equal(first, retried);
  assert.notEqual(first, different);
  assert.equal(requestKey("add_change_order_labor", { request_id: "abc", hours: 2 }), "id:abc");
  assert.notEqual(requestKey("add_change_order_material", { change_order_id: ORDER_ID }), requestKey("add_change_order_labor", { change_order_id: ORDER_ID }));
});

test("a duplicate is reported as already added, not added twice", async () => {
  const { run } = harness({ duplicate: true });
  const result = await run("add_change_order_labor", { change_order_id: ORDER_ID, description: "Troubleshoot", hours: 2 });
  assert.equal(result.structured?.duplicate, true);
  assert.match(result.text, /nothing was added twice/);
});

test("only drafts can be updated, and only their own items removed", async () => {
  const approved = harness({ order: order({ status: "approved", statusLabel: "Approved" }) });
  assert.equal((await approved.run("update_change_order", { change_order_id: ORDER_ID, description: "x" })).structured?.error, "not_editable");
  const draft = harness();
  assert.equal((await draft.run("update_change_order", { change_order_id: ORDER_ID, remove_item_ids: [ITEM_ID] })).structured?.error, "invalid_item_id");
});

test("the summary gives the revised contract total from the same totals as the job page", async () => {
  const items: ChangeOrderItem[] = [
    { id: ITEM_ID, action: "add", kind: "material", description: "Materials", quantity: 1, unit: "each", unitPriceCents: 15_000, lineId: null, original: null },
    { id: "b", action: "add", kind: "labor", description: "Labor", quantity: 2, unit: "hr", unitPriceCents: 12_500, lineId: null, original: null },
  ];
  const { run } = harness({ order: order({}, items) });
  const result = await run("get_change_order_summary", { change_order_id: ORDER_ID });
  assert.equal(result.structured?.original_contract_cents, 240_000);
  assert.equal(result.structured?.added_materials_cents, 15_000);
  assert.equal(result.structured?.added_labor_cents, 25_000);
  assert.equal(result.structured?.net_adjustment_cents, 40_000);
  assert.equal(result.structured?.revised_contract_cents, 280_000);
});

test("asking for approval needs a yes first, never claims approval, and points at the signing link", async () => {
  const { run, called } = harness();
  const proposal = await run("request_change_order_approval", { change_order_id: ORDER_ID, confirmed: false });
  assert.match(proposal.text, /CONFIRMATION REQUIRED/);
  assert.equal(called("requestApproval").length, 0);
  const done = await run("request_change_order_approval", { change_order_id: ORDER_ID, confirmed: true });
  assert.equal(done.structured?.status, "pending_approval");
  assert.equal(done.structured?.next_step, "send_contract_for_signature");
  assert.match(done.text, /NOT approved yet/);
  assert.equal(called("requestApproval").length, 1);
});

test("an unsigned contract is updated instead of amended", async () => {
  const { run, called } = harness({ job: job({ agreement: { id: "agreement", status: "draft", signed: false, signedAt: null, totalCents: 200_000 } }) });
  const result = await run("request_change_order_approval", { change_order_id: ORDER_ID, confirmed: true });
  assert.equal(result.structured?.error, "contract_unsigned");
  assert.equal(called("requestApproval").length, 0);
});

test("a discount needs a yes first, and replacing one says they never stack", async () => {
  const existing = harness({ invoice: summary({ discountCents: 20_000, discountLabel: "Discount (10%)", discount: { type: "percentage", basisPoints: 1000 } }) });
  const proposal = await existing.run("set_invoice_discount", { job_number: "32", discount_type: "fixed", discount_value: 100, confirmed: false });
  assert.match(proposal.text, /CONFIRMATION REQUIRED/);
  assert.match(proposal.text, /never stack/);
  assert.equal(existing.called("setDiscount").length, 0);

  const confirmed = await existing.run("set_invoice_discount", { job_number: "32", discount_type: "fixed", discount_value: "$100", confirmed: true });
  assert.equal(confirmed.isError, undefined);
  assert.deepEqual(existing.called("setDiscount")[0]!.args[1], { type: "fixed", value: "100", reason: undefined });
});

test("discount input is checked: a type, and a value unless removing", async () => {
  const { run, called } = harness();
  assert.equal((await run("set_invoice_discount", { job_number: "32", discount_type: "bogus", confirmed: true })).structured?.error, "invalid_discount_type");
  assert.equal((await run("set_invoice_discount", { job_number: "32", discount_type: "percentage", confirmed: true })).structured?.error, "missing_discount_value");
  await run("set_invoice_discount", { job_number: "32", discount_type: "none", confirmed: true });
  assert.deepEqual(called("setDiscount")[0]!.args[1], { type: "none", value: "", reason: undefined });
});

test("an invoice with no discount reports no discount at all, and one with a discount reports it", async () => {
  assert.equal(invoiceJson(summary()).discount, null);
  const { run } = harness();
  const plain = await run("get_invoice_summary", { job_number: "32" });
  assert.doesNotMatch(plain.text, /Discount/);
  const discounted = invoiceJson(
    summary({ discountCents: 22_000, discountLabel: "Discount (10%)", discount: { type: "percentage", basisPoints: 1000 }, subtotalCents: 220_000, totalCents: 198_000 }),
  );
  assert.deepEqual(discounted.discount, { type: "percentage", value: 10, amount_cents: 22_000, label: "Discount (10%)", reason: null, capped: false });
  assert.equal(discounted.total_cents, 198_000);
});
