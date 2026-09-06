import test from "node:test";
import assert from "node:assert/strict";

import { bookingPageState, bookingPayNotice } from "./booking-page-state.ts";

test("a held appointment is not described as booked before payment", () => {
  assert.equal(
    bookingPageState({ status: "awaiting_payment", depositPaid: false, depositCents: 18_000 }),
    "awaiting_payment",
  );
});

test("an elapsed hold is not described as still being held", () => {
  assert.equal(
    bookingPageState({
      status: "awaiting_payment",
      depositPaid: false,
      depositCents: 18_000,
      expiresAt: "2026-09-05T20:30:00.000Z",
      nowMs: Date.parse("2026-09-05T20:30:00.000Z"),
    }),
    "contact_business",
  );
});

test("a hold remains payable before its deadline", () => {
  assert.equal(
    bookingPageState({
      status: "awaiting_payment",
      depositPaid: false,
      depositCents: 18_000,
      expiresAt: "2026-09-05T20:31:00.000Z",
      nowMs: Date.parse("2026-09-05T20:30:00.000Z"),
    }),
    "awaiting_payment",
  );
});

test("a paid scheduled diagnostic is confirmed", () => {
  assert.equal(
    bookingPageState({ status: "scheduled", depositPaid: true, depositCents: 18_000 }),
    "confirmed",
  );
});

test("money received without a scheduled job asks for review, not another payment", () => {
  assert.equal(
    bookingPageState({ status: "needs_review", depositPaid: true, depositCents: 18_000 }),
    "payment_review",
  );
});

test("an old unpaid scheduled request is not called confirmed when a fee was due", () => {
  assert.equal(
    bookingPageState({ status: "scheduled", depositPaid: false, depositCents: 18_000 }),
    "contact_business",
  );
});

test("a genuinely free scheduled visit can still be confirmed", () => {
  assert.equal(
    bookingPageState({ status: "confirmed", depositPaid: false, depositCents: 0 }),
    "confirmed",
  );
});

test("checkout outcomes are explained without claiming payment failed", () => {
  assert.match(bookingPayNotice("canceled"), /not confirmed/i);
  assert.match(bookingPayNotice("unavailable"), /try again/i);
  assert.match(bookingPayNotice("expired"), /another time/i);
  assert.equal(bookingPayNotice(undefined), "");
});
