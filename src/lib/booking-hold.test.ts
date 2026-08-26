import test from "node:test";
import assert from "node:assert/strict";

import {
  decideHold,
  feeLabel,
  heldReply,
  holdSentence,
  holdSpoken,
  payLinkFor,
  HOLD_MINUTES,
} from "./booking-hold.ts";

test("a booked visit with a fee is held, not scheduled", () => {
  // The whole point: the web page has always held and charged, and a booking
  // taken by text became a confirmed job with nothing collected.
  const decision = decideHold({ intent: "book", depositCents: 10000, paymentsAvailable: true });

  assert.equal(decision.kind, "hold");
  assert.equal(decision.kind === "hold" && decision.feeCents, 10000);
  assert.equal(decision.kind === "hold" && decision.holdMinutes, HOLD_MINUTES);
});

test("a callback owes nothing, so nothing is held", () => {
  const decision = decideHold({ intent: "callback", depositCents: 10000, paymentsAvailable: true });
  assert.equal(decision.kind, "schedule");
});

test("no fee means no hold", () => {
  for (const depositCents of [0, null, undefined]) {
    const decision = decideHold({ intent: "book", depositCents, paymentsAvailable: true });
    assert.equal(decision.kind, "schedule", String(depositCents));
  }
});

test("without payments configured it books exactly the way it books today", () => {
  // The fallback that makes this change unable to be worse than what it
  // replaces: no provider, no link, no hold — the current behaviour.
  const decision = decideHold({ intent: "book", depositCents: 10000, paymentsAvailable: false });

  assert.equal(decision.kind, "schedule");
  assert.equal(decision.kind === "schedule" && decision.because, "payments are not configured");
});

test("a nonsense fee is not a fee", () => {
  const decision = decideHold({ intent: "book", depositCents: Number.NaN, paymentsAvailable: true });
  assert.equal(decision.kind, "schedule");
});

test("the pay link is built from the origin, or not at all", () => {
  assert.equal(
    payLinkFor("https://volteira.com", "abc-123"),
    "https://volteira.com/booking/abc-123/pay",
  );
  // Trailing slashes are how two slashes end up in a texted URL.
  assert.equal(
    payLinkFor("https://volteira.com/", "abc-123"),
    "https://volteira.com/booking/abc-123/pay",
  );
  // No origin configured, no link — never a relative URL in a text message.
  assert.equal(payLinkFor("", "abc-123"), "");
  assert.equal(payLinkFor("volteira.com", "abc-123"), "");
  assert.equal(payLinkFor("https://volteira.com", ""), "");
});

test("money is said the way a fee is said", () => {
  assert.equal(feeLabel(10000), "$100");
  assert.equal(feeLabel(12500), "$125");
  assert.equal(feeLabel(9950), "$99.50");
});

test("the held sentence names the amount and the link", () => {
  const said = holdSentence({
    feeCents: 10000,
    payUrl: "https://volteira.com/booking/abc/pay",
    holdMinutes: 30,
  });

  assert.match(said, /\$100 diagnostic fee/);
  assert.match(said, /https:\/\/volteira\.com\/booking\/abc\/pay/);
  assert.match(said, /30 minutes/);
});

test("no link, nothing said — never a sentence pointing nowhere", () => {
  assert.equal(holdSentence({ feeCents: 10000, payUrl: "", holdMinutes: 30 }), "");
  assert.equal(
    holdSentence({ feeCents: 0, payUrl: "https://volteira.com/booking/abc/pay", holdMinutes: 30 }),
    "",
  );
});

test("a held booking gets its own words, not a contradiction", () => {
  // "booked for Thursday" followed by "pay to confirm" is a message that
  // disagrees with itself inside two lines.
  const said = heldReply({
    businessName: "Pacific Plains Electric",
    slotLabel: "Thursday 8–10am",
    feeCents: 10000,
    payUrl: "https://volteira.com/booking/abc/pay",
    holdMinutes: 30,
    businessPhone: "555-0100",
  });

  assert.match(said, /holding Thursday 8–10am/);
  assert.doesNotMatch(said, /booked/i);
  assert.match(said, /\$100/);
  assert.match(said, /555-0100/);
});

test("no link, no held reply — the caller falls back to the booked one", () => {
  assert.equal(
    heldReply({
      businessName: "Pacific Plains Electric",
      slotLabel: "Thursday 8–10am",
      feeCents: 10000,
      payUrl: "",
      holdMinutes: 30,
      businessPhone: "555-0100",
    }),
    "",
  );
});

test("spoken, there is no URL to read out", () => {
  const said = holdSpoken({ feeCents: 10000 });

  assert.match(said, /\$100/);
  assert.match(said, /text you a link/);
  assert.match(said, /confirms the appointment/);
  assert.doesNotMatch(said, /https?:/);
  assert.equal(holdSpoken({ feeCents: 0 }), "");
});

test("a held appointment is explained in Spanish to a Spanish caller", () => {
  const said = holdSpoken({ feeCents: 10000, language: "es" });

  assert.match(said, /Le enviaré por mensaje un enlace/);
  assert.match(said, /\$100/);
  assert.match(said, /el pago confirma la cita/);
  assert.doesNotMatch(said, /I will text/i);
});
