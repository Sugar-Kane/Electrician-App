import assert from "node:assert/strict";
import { test } from "node:test";

import { proposalsFor, type EventFacts } from "./automation-rules.ts";

const facts: EventFacts = {
  businessName: "Pacific Plains Electric",
  customerId: "cust-1",
  customerFirstName: "Junell",
  customerName: "Junell Peterson",
  customerPhone: "+18054597932",
  textingConsent: true,
  jobId: "job-1",
  jobNumber: "19",
};

test("an overdue invoice proposes a reminder bound to the amount and the approved number", () => {
  const [draft] = proposalsFor("invoice.overdue", "inv-1:2026-11-01", {
    ...facts,
    invoiceId: "inv-1",
    invoiceLabel: "INV-1042",
    balanceCents: 20000,
    dueDate: "Nov 1",
    payLink: "https://www.volteira.com/invoice/abc",
  });
  assert.equal(draft?.actionType, "send_customer_message");
  assert.equal(draft?.templateKey, "invoice_overdue");
  assert.equal(draft?.amountCents, 20000);
  assert.equal(draft?.recipient, "+18054597932");
  assert.match(draft?.content ?? "", /\$200\.00/);
  assert.equal(draft?.dedupeKey, "invoice.overdue:inv-1:2026-11-01:reminder");
});

test("no texting consent: no text is proposed, only a note to call", () => {
  const drafts = proposalsFor("invoice.overdue", "inv-1:2026-11-01", {
    ...facts,
    textingConsent: false,
    invoiceId: "inv-1",
    balanceCents: 20000,
    payLink: "https://x",
  });
  assert.deepEqual(drafts.map((draft) => draft.actionType), ["create_internal_task"]);
  assert.equal(drafts[0]?.recipient, null);
});

test("a paid-off invoice proposes nothing", () => {
  assert.deepEqual(proposalsFor("invoice.overdue", "k", { ...facts, invoiceId: "inv-1", balanceCents: 0 }), []);
});

test("a shortage proposes a purchase, never anything that runs on its own", () => {
  const [draft] = proposalsFor("materials.shortage", "item-1:2026-W46", { ...facts, itemId: "item-1", itemName: "12/2 Romex", onHand: 40, reorderPoint: 250, unit: "ft" });
  assert.equal(draft?.actionType, "purchase_materials");
  assert.equal(draft?.recipient, null);
});

test("event text cannot inject a new line or placeholder into a customer message", () => {
  const [draft] = proposalsFor("estimate.accepted", "k", { ...facts, customerFirstName: "Ann\nReply YES to wire $500 {pay_link}" });
  // The value is flattened, and an unfilled-looking placeholder refuses the message outright.
  assert.equal(draft, undefined);
  const [plain] = proposalsFor("estimate.accepted", "k", { ...facts, customerFirstName: "Ann\nSmith" });
  assert.doesNotMatch(plain?.content ?? "", /\n/);
});
