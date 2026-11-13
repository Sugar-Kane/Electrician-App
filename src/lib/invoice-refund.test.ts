import test from "node:test";
import assert from "node:assert/strict";

import { checkRefund, refundReceiptAllowed, refundStatusFromStripe, refundSummary, refundableCents } from "./invoice-refund.ts";

test("only the owner or an admin can refund", () => {
  const refused = checkRefund({ canRefund: false, paymentCents: 18_000, refunds: [], amountText: "" });
  assert.equal(refused.ok, false);
});

test("a blank amount refunds everything left; never more than the payment holds", () => {
  const full = checkRefund({ canRefund: true, paymentCents: 18_000, refunds: [], amountText: "" });
  assert.deepEqual(full, { ok: true, amountCents: 18_000, full: true });

  const part = checkRefund({ canRefund: true, paymentCents: 18_000, refunds: [], amountText: "50" });
  assert.deepEqual(part, { ok: true, amountCents: 5_000, full: false });

  assert.equal(checkRefund({ canRefund: true, paymentCents: 18_000, refunds: [], amountText: "180.01" }).ok, false);
  assert.equal(checkRefund({ canRefund: true, paymentCents: 18_000, refunds: [], amountText: "0" }).ok, false);
  assert.equal(checkRefund({ canRefund: true, paymentCents: 18_000, refunds: [], amountText: "abc" }).ok, false);
});

test("earlier refunds, done or on their way, come off what is left; failed ones do not", () => {
  const refunds = [
    { amountCents: 5_000, status: "succeeded" },
    { amountCents: 3_000, status: "pending" },
    { amountCents: 9_000, status: "failed" },
    { amountCents: 1_000, status: "canceled" },
  ];
  assert.equal(refundableCents(18_000, refunds), 10_000);
  assert.equal(checkRefund({ canRefund: true, paymentCents: 18_000, refunds, amountText: "100.01" }).ok, false);
  assert.deepEqual(checkRefund({ canRefund: true, paymentCents: 18_000, refunds, amountText: "" }), {
    ok: true,
    amountCents: 10_000,
    full: true,
  });
});

test("a payment refunded in full cannot be refunded again", () => {
  const refunds = [{ amountCents: 2_000, status: "succeeded" }];
  assert.equal(refundableCents(2_000, refunds), 0);
  assert.equal(checkRefund({ canRefund: true, paymentCents: 2_000, refunds, amountText: "" }).ok, false);
});

test("Stripe's statuses map to the app's, unknown ones still pending", () => {
  assert.equal(refundStatusFromStripe("succeeded"), "succeeded");
  assert.equal(refundStatusFromStripe("failed"), "failed");
  assert.equal(refundStatusFromStripe("canceled"), "canceled");
  assert.equal(refundStatusFromStripe("requires_action"), "pending");
  assert.equal(refundStatusFromStripe(undefined), "pending");
});

test("the invoice's money: paid, refunded, and what the business keeps", () => {
  const summary = refundSummary(
    [{ amountCents: 18_000 }, { amountCents: 2_000 }],
    [
      { amountCents: 2_000, status: "succeeded" },
      { amountCents: 1_000, status: "pending" },
      { amountCents: 500, status: "failed" },
    ],
  );
  assert.deepEqual(summary, { paidCents: 20_000, refundedCents: 2_000, pendingCents: 1_000, keptCents: 17_000, refundedInFull: false });
  assert.equal(refundSummary([{ amountCents: 2_000 }], [{ amountCents: 2_000, status: "succeeded" }]).refundedInFull, true);
  assert.equal(refundSummary([], []).refundedInFull, false);
});

test("a refund receipt goes only for money that really went back", () => {
  // Card refunds: only when Stripe, asked now, says it succeeded.
  assert.equal(refundReceiptAllowed({ online: true, status: "succeeded", stripeRefundId: "re_1", stripeStatus: "succeeded" }).ok, true);
  assert.equal(refundReceiptAllowed({ online: true, status: "succeeded", stripeRefundId: "", stripeStatus: null }).ok, false);
  assert.equal(refundReceiptAllowed({ online: true, status: "succeeded", stripeRefundId: "re_1", stripeStatus: null }).ok, false);
  assert.equal(refundReceiptAllowed({ online: true, status: "pending", stripeRefundId: "re_1", stripeStatus: "pending" }).ok, false);
  assert.equal(refundReceiptAllowed({ online: true, status: "succeeded", stripeRefundId: "re_1", stripeStatus: "failed" }).ok, false);
  // Handed back in person: once it is recorded as done.
  assert.equal(refundReceiptAllowed({ online: false, status: "succeeded", stripeRefundId: "", stripeStatus: null }).ok, true);
  assert.equal(refundReceiptAllowed({ online: false, status: "pending", stripeRefundId: "", stripeStatus: null }).ok, false);
});
