/**
 * Compliance regression tests: the rules Volteira relies on for money, consent, signatures and
 * tenant boundaries, named by compliance test ID (CT-…). compliance/tests/manifest.json maps
 * each test ID to the requirement IDs it supports. These test the code's rules only; whether
 * every pathway calls them is assessed in the audit, not here.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import { canEditBilling } from "../lib/billing-permission.ts";
import { readSignature, unsignableBecause } from "../lib/contract-signing.ts";
import { esignConsentLine, esignConsentSections } from "../lib/esign-consent.ts";
import { diagnosticCreditFor, invoiceTotals } from "../lib/invoice-math.ts";
import { checkRefund, refundableCents } from "../lib/invoice-refund.ts";
import {
  DOWN_PAYMENT_NOTICE,
  contractPaymentTerms,
  matchesSignedSchedule,
  maxDownPaymentCents,
  doneProgressCents,
  payLinkCents,
  payLinkPayable,
  paymentIsDue,
  paymentPayable,
  planAmounts,
  preWorkAllowanceCents,
  preWorkRefusal,
  shouldRequestPayment,
} from "../lib/payment-plan.ts";
import { isPublicPath } from "../lib/public-paths.ts";
import { smsConsentDisclosure } from "../lib/sms-consent.ts";
import { OPT_OUT_CONFIRMATION, readOptOut } from "../lib/messaging-rules.ts";
import { isOwnedObjectPath } from "../lib/tenant-storage-path.ts";
import { verifyXaiWebhook } from "../lib/xai-webhook.ts";

const dollars = (n: number) => n * 100;

test("CT-DEPOSIT-001: the down payment cap is the lesser of $1,000 or 10% at every contract size", () => {
  const cases: [number, number][] = [
    [500, 50],
    [1_000, 100],
    [5_000, 500],
    [10_000, 1_000],
    [25_000, 1_000],
    [100_000, 1_000],
  ];
  for (const [price, cap] of cases) {
    assert.equal(maxDownPaymentCents(dollars(price)), dollars(cap), `$${price} job`);
    // At the cap: allowed. One cent over: refused.
    assert.equal(planAmounts(dollars(price), [{ kind: "deposit", amountType: "fixed", amountCents: dollars(cap), due: "on_signing" }]).ok, true, `$${price} at cap`);
    assert.equal(planAmounts(dollars(price), [{ kind: "deposit", amountType: "fixed", amountCents: dollars(cap) + 1, due: "on_signing" }]).ok, false, `$${price} over cap`);
  }
});

test("CT-DEPOSIT-002: splitting the down payment across several on-signing payments cannot beat the cap", () => {
  const plan = planAmounts(dollars(25_000), [
    { kind: "deposit", amountType: "fixed", amountCents: dollars(800), due: "on_signing" },
    { kind: "installment", amountType: "fixed", amountCents: dollars(800), due: "on_signing" },
  ]);
  assert.equal(plan.ok, false);
  // A percentage deposit is checked the same way.
  assert.equal(planAmounts(dollars(25_000), [{ kind: "deposit", amountType: "percent", percentBps: 500, due: "on_signing" }]).ok, false);
});

test("CT-DEPOSIT-003: a pay link never asks for more than the plan, and never for money already paid or clearing", () => {
  const plan = planAmounts(dollars(10_000), [
    { kind: "deposit", amountType: "fixed", amountCents: dollars(1_000), due: "on_signing" },
    { kind: "installment", amountType: "fixed", amountCents: dollars(4_000), due: "on_date", dueDate: "2026-12-15" },
  ]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  assert.equal(payLinkCents(plan.payments, 0, { prepaidCents: 0 }), dollars(1_000));
  assert.equal(payLinkCents(plan.payments, 0, { prepaidCents: dollars(1_000) }), 0);
  assert.equal(payLinkCents(plan.payments, 0, { prepaidCents: 0, processingCents: dollars(1_000) }), 0);
  assert.equal(payLinkCents(plan.payments, 2, { prepaidCents: dollars(20_000) }), 0);
});

test("CT-DEPOSIT-004: the contract states the payment schedule and the statutory down payment notice", () => {
  const plan = planAmounts(dollars(10_000), [{ kind: "deposit", amountType: "fixed", amountCents: dollars(1_000), due: "on_signing" }]);
  assert.equal(plan.ok, true);
  if (!plan.ok) return;
  const terms = contractPaymentTerms(plan.payments, (d) => d);
  assert.match(terms.block, /PAYMENT SCHEDULE/);
  assert.ok(terms.block.includes(DOWN_PAYMENT_NOTICE));
  assert.match(DOWN_PAYMENT_NOTICE, /\$1,000 OR 10 PERCENT/);
});

test("CT-DEPOSIT-005: automatic payment requests only follow the schedule the customer signed", () => {
  const deposit = { kind: "deposit" as const, cents: dollars(1_000), due: "on_signing" as const, dueDate: null };
  const signed = [{ kind: "deposit", cents: dollars(1_000), due: "on_signing", dueDate: null }];
  assert.equal(matchesSignedSchedule([deposit], 0, signed), true);
  assert.equal(matchesSignedSchedule([{ ...deposit, cents: dollars(1_000) + 1 }], 0, signed), false);
  assert.equal(matchesSignedSchedule([deposit], 0, null), false);
});

test("CT-DEPOSIT-006: a progress payment can't be asked for or paid until its work is marked done", () => {
  const signed = { signed: true, completed: false };
  // The audit's case: $1,000 deposit, $8,999 dated tomorrow, $1 balance on a $10,000 job.
  const plan = planAmounts(dollars(10_000), [
    { kind: "deposit", amountType: "fixed", amountCents: dollars(1_000), due: "on_signing" },
    { kind: "installment", amountType: "fixed", amountCents: dollars(8_999), due: "on_date", dueDate: "2026-11-27" },
    { kind: "final", amountType: "fixed", due: "on_completion" },
  ]);
  assert.ok(plan.ok);
  const [deposit, progress, balance] = plan.payments;
  assert.equal(paymentPayable(deposit, signed), true);
  assert.equal(paymentPayable(deposit, { signed: false, completed: false }), false, "no deposit before the contract is signed");
  assert.equal(paymentPayable(progress, signed), false, "the dated payment waits for its work");
  assert.equal(payLinkPayable(plan.payments, 1, signed), false);
  assert.equal(paymentIsDue(progress, { today: "2026-12-01", signed: true, completed: false }), false, "its date alone is not enough");
  assert.equal(
    shouldRequestPayment(progress, { requestedAt: null, owedCents: dollars(8_999), today: "2026-12-01", signed: true, invoiceSent: false }),
    false,
  );
  const done = { ...progress, doneAt: "2026-11-30T17:00:00Z" };
  assert.equal(paymentPayable(done, signed), true);
  assert.equal(payLinkPayable([deposit, done, balance], 1, signed), true);
  assert.equal(
    shouldRequestPayment(done, { requestedAt: null, owedCents: dollars(8_999), today: "2026-12-01", signed: true, invoiceSent: false }),
    true,
  );
  assert.equal(paymentPayable(balance, signed), false, "the balance waits for completion");
  assert.equal(paymentPayable(balance, { signed: true, completed: true }), true);
});

test("CT-DEPOSIT-007: money taken before the work never passes the down payment plus work marked done", () => {
  const base = { contractTotalCents: dollars(20_000), doneCents: 0, collectedCents: 0, completed: false };
  assert.equal(preWorkAllowanceCents(base), dollars(1_000));
  assert.equal(preWorkRefusal({ ...base, proposedCents: dollars(1_000) }), null);
  assert.match(preWorkRefusal({ ...base, proposedCents: dollars(1_000) + 1 }) ?? "", /California limits/);
  // A diagnostic fee being credited toward the work counts as taken.
  assert.equal(preWorkAllowanceCents({ ...base, diagnosticCreditCents: dollars(150) }), dollars(850));
  // Cash recorded on top of a paid deposit is refused.
  assert.notEqual(preWorkRefusal({ ...base, collectedCents: dollars(1_000), proposedCents: dollars(500) }), null);
  // Work marked done opens room for its payment, and no more.
  assert.equal(preWorkAllowanceCents({ ...base, collectedCents: dollars(1_000), doneCents: dollars(6_000) }), dollars(6_000));
  // The signed price is the base: 10% of $5,000 is $500.
  assert.equal(preWorkAllowanceCents({ ...base, contractTotalCents: dollars(5_000) }), dollars(500));
  // Once the job is complete, the rest may be billed.
  assert.equal(preWorkAllowanceCents({ ...base, completed: true }), null);
  assert.equal(preWorkRefusal({ ...base, completed: true, proposedCents: dollars(19_000) }), null);
  // Only progress payments marked done count: not the deposit, not the balance.
  assert.equal(
    doneProgressCents([
      { kind: "deposit", due: "on_signing", doneAt: "x", cents: 100 },
      { kind: "installment", due: "on_date", doneAt: "x", cents: 500 },
      { kind: "installment", due: "on_date", doneAt: null, cents: 700 },
      { kind: "final", due: "on_completion", doneAt: "x", cents: 900 },
    ]),
    500,
  );
});

test("CT-SIGN-001: a signed, void or superseded contract cannot be signed again", () => {
  const base = { status: "sent", unfilled: [] as string[], signatureProvider: null, signedAt: null };
  assert.equal(unsignableBecause(base), "");
  assert.notEqual(unsignableBecause({ ...base, signedAt: "2026-11-01T00:00:00Z" }), "");
  assert.notEqual(unsignableBecause({ ...base, status: "void" }), "");
  assert.notEqual(unsignableBecause({ ...base, superseded: true }), "");
});

test("CT-SIGN-002: a contract with blank required fields cannot be signed", () => {
  const reason = unsignableBecause({ status: "sent", unfilled: ["contractor_license"], signatureProvider: null, signedAt: null });
  assert.match(reason, /not ready to sign/);
});

test("CT-SIGN-003: a signature needs the signer's name (typed) or a drawn image", () => {
  assert.equal(readSignature({ method: "typed", name: "" }).ok, false);
  assert.equal(readSignature({ method: "typed", name: "Jane Customer" }).ok, true);
  assert.equal(readSignature({ method: "drawn", name: "Jane Customer", image: "not-an-image" }).ok, false);
  assert.equal(readSignature({ method: "unknown", name: "Jane Customer" }).ok, false);
});

test("CT-ESIGN-001: the electronic records consent covers paper copies, withdrawal and requirements", () => {
  const text = esignConsentSections("Fixture Electric").map((s) => `${s.heading} ${s.body}`).join(" ").toLowerCase();
  assert.match(text, /paper copy/);
  assert.match(text, /withdraw/);
  assert.match(text, /no charge/);
  assert.match(esignConsentLine("contract"), /electronic signature counts the same as signing by hand/i);
});

test("CT-SMS-001: the texting consent wording carries the required disclosures", () => {
  const text = smsConsentDisclosure("Fixture Electric");
  assert.match(text, /Fixture Electric/);
  assert.match(text, /Message frequency varies/);
  assert.match(text, /Message and data rates may apply/);
  assert.match(text, /Reply STOP to opt out/);
  assert.match(text, /HELP/);
  assert.match(text, /not a condition of purchase/);
});

test("CT-SMS-002: a request to stop texts is honored however the customer words it", () => {
  // The FCC's reply words, Twilio-answered or not.
  for (const word of ["STOP", "Stop.", "quit", "End", "CANCEL", "unsubscribe", "stop all", "Revoke", "opt out", "OPTOUT"]) {
    assert.equal(readOptOut(word).optOut, true, word);
  }
  // The customer's own words, in English and Spanish.
  for (const words of [
    "Please stop texting me",
    "stop sending me messages",
    "Don't text me anymore, call instead",
    "do not contact me",
    "No more texts please",
    "remove me from your list",
    "Take my number off your list",
    "wrong number",
    "Leave me alone",
    "No me envíen más mensajes",
    "Alto",
    "dejen de mandar mensajes",
    "BAJA",
  ]) {
    assert.equal(readOptOut(words).optOut, true, words);
  }
  // Ordinary job talk is not an opt-out.
  for (const words of [
    "cancel my appointment for Tuesday",
    "Can you stop by at 3?",
    "I need to cancel",
    "The breaker won't stop tripping",
    "I got no texts yesterday about the time",
    "yes",
    "START",
    "",
  ]) {
    assert.equal(readOptOut(words).optOut, false, words);
  }
  // Twilio confirms its own keywords; Volteira confirms only the ones it caught itself, once.
  assert.deepEqual(readOptOut("STOP"), { optOut: true, carrierHandled: true });
  assert.deepEqual(readOptOut("please stop texting me"), { optOut: true, carrierHandled: false });
  assert.deepEqual(readOptOut("alto"), { optOut: true, carrierHandled: false });
  assert.match(OPT_OUT_CONFIRMATION, /START/);
});

test("CT-REFUND-001: a refund never exceeds what was paid, and only owners or admins may refund", () => {
  assert.equal(refundableCents(dollars(100), [{ amountCents: dollars(60), status: "succeeded" }]), dollars(40));
  assert.equal(checkRefund({ canRefund: false, paymentCents: dollars(100), refunds: [], amountText: "10" }).ok, false);
  assert.equal(checkRefund({ canRefund: true, paymentCents: dollars(100), refunds: [{ amountCents: dollars(100), status: "succeeded" }], amountText: "1" }).ok, false);
  assert.equal(checkRefund({ canRefund: true, paymentCents: dollars(100), refunds: [], amountText: "150" }).ok, false);
});

test("CT-INVOICE-001: the diagnostic fee is credited once, and never below zero", () => {
  assert.equal(diagnosticCreditFor({ diagnosticPaid: false, diagnosticFeeCents: dollars(180) }), 0);
  assert.equal(diagnosticCreditFor({ diagnosticPaid: true, diagnosticFeeCents: dollars(180) }), dollars(180));
  assert.equal(diagnosticCreditFor({ diagnosticPaid: true, diagnosticFeeCents: dollars(180), alreadyCreditedCents: dollars(180) }), 0);
  const totals = invoiceTotals({ subtotalCents: dollars(100), diagnosticPaidCents: dollars(180) } as Parameters<typeof invoiceTotals>[0]);
  assert.ok(totals.totalCents >= 0);
});

test("CT-AUTHZ-001: technicians cannot change billing unless the owner allows it", () => {
  assert.equal(canEditBilling("technician", false), false);
  assert.equal(canEditBilling("technician", true), true);
  assert.equal(canEditBilling("owner", false), true);
  assert.equal(canEditBilling("", true), false);
});

test("CT-TENANT-001: storage paths outside the business's own folder are refused", () => {
  const mine = "11111111-1111-4111-8111-111111111111";
  const theirs = "22222222-2222-4222-8222-222222222222";
  assert.equal(isOwnedObjectPath(`${mine}/jobs/abc/photo.jpg`, mine), true);
  assert.equal(isOwnedObjectPath(`${theirs}/jobs/abc/photo.jpg`, mine), false);
  assert.equal(isOwnedObjectPath(`${mine}/../${theirs}/photo.jpg`, mine), false);
  assert.equal(isOwnedObjectPath(`${mine}`, mine), false);
});

test("CT-PUBLIC-001: only customer-link and public pages are reachable without signing in", () => {
  for (const p of ["/invoice/abc", "/contract/abc", "/pay/abc", "/book/x"]) assert.equal(isPublicPath(p), true, p);
  for (const p of ["/jobs/1", "/customers/1", "/invoices", "/settings/contract", "/admin"]) assert.equal(isPublicPath(p), false, p);
});

test("CT-WEBHOOK-001: an unsigned, tampered or stale webhook is rejected", () => {
  const secret = "whsec_" + Buffer.from("compliance-fixture-secret-0001").toString("base64");
  const now = new Date("2026-11-24T12:00:00Z");
  const body = JSON.stringify({ type: "realtime.call.incoming" });
  const sign = (b: string, ts: number) => {
    const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
    return `v1,${createHmac("sha256", key).update(`evt_1.${ts}.${b}`).digest("base64")}`;
  };
  const ts = Math.floor(now.getTime() / 1000);
  const ok = (b: string, sig: string, t: number) =>
    verifyXaiWebhook({ secret, body: b, now, headers: { id: "evt_1", timestamp: String(t), signature: sig } });
  assert.equal(ok(body, sign(body, ts), ts), true);
  assert.equal(ok(body + " ", sign(body, ts), ts), false);
  assert.equal(ok(body, "v1,AAAA", ts), false);
  assert.equal(ok(body, sign(body, ts - 3600), ts - 3600), false);
  assert.equal(verifyXaiWebhook({ secret: "", body, now, headers: { id: "evt_1", timestamp: String(ts), signature: sign(body, ts) } }), false);
});
