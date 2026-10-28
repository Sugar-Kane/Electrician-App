import test from "node:test";
import assert from "node:assert/strict";

import {
  canMoveAttempt,
  checkOnlinePayment,
  methodFromStripeType,
  onlineEventAction,
  type PayableOnline,
} from "./invoice-online-payment.ts";

const sent = (over: Partial<PayableOnline> = {}): PayableOnline => ({
  status: "sent",
  lastSentAt: "2026-10-27T18:00:00Z",
  totalCents: 128_000,
  balanceDueCents: 128_000,
  attempts: [],
  ...over,
});

test("only a sent, unpaid invoice can be paid online, and only for what is still owed", () => {
  assert.deepEqual(checkOnlinePayment(sent()), { ok: true, amountCents: 128_000 });
  assert.deepEqual(checkOnlinePayment(sent({ status: "partially_paid", balanceDueCents: 30_000 })), { ok: true, amountCents: 30_000 });
  assert.deepEqual(checkOnlinePayment(sent({ status: "overdue" })), { ok: true, amountCents: 128_000 });
  assert.equal(checkOnlinePayment(sent({ status: "draft", lastSentAt: null })).ok, false);
  assert.equal(checkOnlinePayment(sent({ status: "void" })).ok, false);
  assert.equal(checkOnlinePayment(sent({ status: "paid", balanceDueCents: 0 })).ok, false);
  assert.deepEqual(checkOnlinePayment(sent({ balanceDueCents: 0 })), { ok: false, reason: "nothing_owed" });
  assert.deepEqual(checkOnlinePayment(sent({ balanceDueCents: 30 })), { ok: false, reason: "too_small" });
});

test("a bank payment still clearing blocks a second payment; a failed or abandoned one does not", () => {
  assert.deepEqual(checkOnlinePayment(sent({ attempts: [{ status: "processing", amountCents: 128_000 }] })), {
    ok: false,
    reason: "processing",
    processingCents: 128_000,
  });
  assert.equal(checkOnlinePayment(sent({ attempts: [{ status: "failed", amountCents: 128_000 }] })).ok, true);
  assert.equal(checkOnlinePayment(sent({ attempts: [{ status: "expired", amountCents: 128_000 }, { status: "open", amountCents: 1 }] })).ok, true);
});

test("a card is paid when checkout completes; a bank payment only when it clears", () => {
  assert.equal(onlineEventAction("checkout.session.completed", "paid"), "settle");
  assert.equal(onlineEventAction("checkout.session.completed", "unpaid"), "processing");
  assert.equal(onlineEventAction("checkout.session.async_payment_succeeded", "paid"), "settle");
  assert.equal(onlineEventAction("checkout.session.async_payment_failed", "unpaid"), "failed");
  assert.equal(onlineEventAction("checkout.session.expired", "unpaid"), "expired");
  assert.equal(onlineEventAction("checkout.session.completed", "no_payment_required"), "ignore");
  assert.equal(onlineEventAction("customer.subscription.updated", null), "ignore");
});

test("a cleared payment never goes back, and a late expiry does not undo a submitted bank payment", () => {
  assert.equal(canMoveAttempt("succeeded", "failed"), false);
  assert.equal(canMoveAttempt("succeeded", "expired"), false);
  assert.equal(canMoveAttempt("processing", "expired"), false);
  assert.equal(canMoveAttempt("open", "processing"), true);
  assert.equal(canMoveAttempt("processing", "failed"), true);
  assert.equal(canMoveAttempt("processing", "succeeded"), true);
  assert.equal(methodFromStripeType("us_bank_account"), "bank");
  assert.equal(methodFromStripeType("card"), "card");
  assert.equal(methodFromStripeType("link"), "card");
});
