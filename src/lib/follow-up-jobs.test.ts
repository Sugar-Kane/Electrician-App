import test from "node:test";
import assert from "node:assert/strict";

import { creditGivenCents, creditSource, followUpPrefill, type FollowUpSource } from "./follow-up-jobs.ts";
import { diagnosticCreditFor } from "./invoice-math.ts";

const diagnostic: FollowUpSource = {
  customerName: " Brian Foster ",
  phone: "+18055550194",
  email: "brian@example.com",
  addressLine1: "88 Calle Cielo",
  addressLine2: "",
  city: "Nipomo",
  state: "ca",
  postalCode: "93444-1234",
  accessNotes: "Side gate. Dog is friendly.",
  technicianNotes: "  Subpanel bus bar is scorched. Replace the subpanel.  ",
  customerDescription: "A breaker in the garage subpanel is buzzing.",
};

test("a work order starts out as the diagnostic's customer, at the same address", () => {
  const values = followUpPrefill(diagnostic);
  assert.equal(values.customerName, "Brian Foster");
  // The stored +1 number becomes the ten digits the phone box keeps.
  assert.equal(values.phone, "8055550194");
  assert.equal(values.email, "brian@example.com");
  assert.equal(values.addressLine1, "88 Calle Cielo");
  assert.equal(values.city, "Nipomo");
  assert.equal(values.state, "CA");
  assert.equal(values.postalCode, "93444");
  assert.equal(values.accessNotes, "Side gate. Dog is friendly.");
});

test("it is a work order, for what the diagnostic found", () => {
  const values = followUpPrefill(diagnostic);
  assert.equal(values.category, "work_order");
  assert.equal(values.description, "Subpanel bus bar is scorched. Replace the subpanel.");
  // Nothing written down on the visit: what the customer asked for instead.
  assert.equal(
    followUpPrefill({ ...diagnostic, technicianNotes: "   " }).description,
    "A breaker in the garage subpanel is buzzing.",
  );
});

test("when, how long and what it costs are left for the owner", () => {
  const values = followUpPrefill(diagnostic);
  assert.equal(values.startLocal, "");
  assert.equal(values.durationHours, "");
  assert.equal(values.cost, "");
  assert.equal(values.workOrderLines, "");
  assert.equal(values.mode, "save");
});

test("a follow-up takes off the fee paid for the diagnostic it follows", () => {
  const paid = { diagnosticPaid: true, diagnosticFeeCents: 18_000 };
  // The work order's own columns say nothing was paid for it.
  const workOrder = { diagnosticPaid: false, diagnosticFeeCents: 0, followUpOf: "diagnostic-id" };
  assert.deepEqual(creditSource(workOrder, paid), paid);
  // A job that follows nothing takes off its own.
  assert.deepEqual(creditSource({ ...paid, followUpOf: null }, null), paid);
  assert.deepEqual(
    creditSource({ diagnosticPaid: false, diagnosticFeeCents: 18_000, followUpOf: null }, paid),
    { diagnosticPaid: false, diagnosticFeeCents: 18_000 },
  );
});

test("a follow-up whose diagnostic cannot be read takes nothing off", () => {
  assert.deepEqual(
    creditSource({ diagnosticPaid: true, diagnosticFeeCents: 18_000, followUpOf: "gone" }, null),
    { diagnosticPaid: false, diagnosticFeeCents: 0 },
  );
});

test("the fee comes off once across the diagnostic and its follow-ups", () => {
  const fee = { diagnosticPaid: true, diagnosticFeeCents: 18_000 };
  // Nothing billed yet: all of it.
  assert.equal(diagnosticCreditFor({ ...fee, alreadyCreditedCents: creditGivenCents([]) }), 18_000);
  // $125 of it went on the diagnostic's own invoice: the rest on the work order.
  const given = creditGivenCents([{ status: "sent", diagnosticCreditCents: 12_500 }]);
  assert.equal(diagnosticCreditFor({ ...fee, alreadyCreditedCents: given }), 5_500);
  // All of it went on the work order's first invoice: none on its second.
  assert.equal(
    diagnosticCreditFor({
      ...fee,
      alreadyCreditedCents: creditGivenCents([
        { status: "paid", diagnosticCreditCents: 18_000 },
        { status: "draft", diagnosticCreditCents: 0 },
      ]),
    }),
    0,
  );
});

test("a voided invoice gave nothing, so its credit is still there", () => {
  assert.equal(
    creditGivenCents([
      { status: "void", diagnosticCreditCents: 18_000 },
      { status: "draft", diagnosticCreditCents: 0 },
    ]),
    0,
  );
  // Rubbish in a credit column is not a credit.
  assert.equal(
    creditGivenCents([
      { status: "sent", diagnosticCreditCents: Number.NaN },
      { status: "sent", diagnosticCreditCents: -500 },
      { status: "sent", diagnosticCreditCents: 4_000 },
    ]),
    4_000,
  );
});
