import test from "node:test";
import assert from "node:assert/strict";

import {
  authorizationText,
  collectionRefusal,
  creditNotice,
  displayState,
  effectiveDiagnosticPolicy,
  nextAuthorizationState,
  priceSummary,
  redactPaymentSecrets,
  repairContractFor,
  settingsFromRow,
  diagnosticInvoiceRefusal,
  type CollectionInput,
  type DiagnosticPaymentSettings,
} from "./diagnostic-payment-policy.ts";

const settings = (overrides: Partial<DiagnosticPaymentSettings> = {}): DiagnosticPaymentSettings => ({
  feeCents: 18_000,
  jurisdiction: "CA",
  collectAt: "after_completion",
  requirePaymentMethod: true,
  autoCollect: true,
  allowManualAfterCompletion: true,
  creditTowardRepairs: true,
  sendSetupReminders: true,
  sendFailedPaymentNotices: true,
  serviceDescription: "",
  ...overrides,
});

const eligible = (overrides: Partial<CollectionInput> = {}): CollectionInput => ({
  via: "app",
  actorRole: "owner",
  actorCanBill: true,
  policy: { collectAt: "after_completion", autoCollect: true, allowManualAfterCompletion: true },
  job: {
    organizationId: "org-a",
    status: "in_progress",
    canceled: false,
    diagnosticPaid: false,
    diagnosticCompletedAt: "2026-11-26T18:00:00Z",
    diagnosticFindings: "Tripped AFCI on bedroom circuit; loose neutral found and tightened.",
    repairContract: "none",
    largerSignedContract: false,
  },
  authorization: {
    organizationId: "org-a",
    state: "payment_method_saved",
    amountCents: 18_000,
    hasPaymentMethod: true,
    stripeAccountId: "acct_A",
  },
  account: { stripeAccountId: "acct_A", chargesEnabled: true },
  requestedCents: 18_000,
  openCharge: false,
  ...overrides,
});

test("California: nothing is due today and the fee is due on completion", () => {
  const policy = effectiveDiagnosticPolicy(settings());
  assert.equal(policy.collectAt, "after_completion");
  assert.equal(policy.dueTodayCents, 0);
  assert.equal(policy.dueOnCompletionCents, 18_000);
  assert.deepEqual(priceSummary(policy).map((row) => row.amount), ["$180.00", "$0.00", "$180.00"]);
});

test("California overrides a contractor who asks for upfront payment", () => {
  const policy = effectiveDiagnosticPolicy(settings({ collectAt: "at_booking" }));
  assert.equal(policy.collectAt, "after_completion");
  assert.equal(policy.dueTodayCents, 0);
  assert.equal(policy.overrides.length, 1);
});

test("a business with no jurisdiction set gets the conservative rule", () => {
  const policy = effectiveDiagnosticPolicy(settings({ jurisdiction: "", collectAt: "at_booking" }));
  assert.equal(policy.collectAt, "after_completion");
  assert.equal(policy.dueTodayCents, 0);
});

test("another state may keep upfront collection when the contractor chooses it", () => {
  const policy = effectiveDiagnosticPolicy(settings({ jurisdiction: "NV", collectAt: "at_booking" }));
  assert.equal(policy.collectAt, "at_booking");
  assert.equal(policy.dueTodayCents, 18_000);
  assert.equal(policy.autoCollect, false, "nothing to auto-collect when it was paid at booking");
});

test("stored settings default to the safe choices", () => {
  const read = settingsFromRow({ diagnostic_fee_cents: 18_000 }, "ca");
  assert.equal(read.jurisdiction, "CA");
  assert.equal(read.collectAt, "after_completion");
  assert.equal(read.requirePaymentMethod, true);
});

test("the authorization text names the business and the fee, in English and Spanish", () => {
  assert.equal(
    authorizationText({ businessName: "Pacific Plains Electric", feeCents: 18_000 }),
    "I authorize Pacific Plains Electric to securely save my payment method and charge $180 upon completion of the contracted electrical diagnostic service. No diagnostic payment will be collected today.",
  );
  const es = authorizationText({ businessName: "Pacific Plains Electric", feeCents: 18_000, language: "es" });
  assert.match(es, /Pacific Plains Electric/);
  assert.match(es, /\$180/);
  assert.match(es, /Hoy no se cobrará/);
  assert.match(creditNotice("es"), /acreditará/);
});

test("an eligible, completed standalone diagnostic may be collected", () => {
  assert.equal(collectionRefusal(eligible()), null);
});

test("premature collection is refused before the diagnostic is complete", () => {
  const input = eligible();
  input.job.diagnosticCompletedAt = null;
  assert.match(collectionRefusal(input) ?? "", /not been marked complete/);
});

test("findings must be documented before collecting", () => {
  const input = eligible();
  input.job.diagnosticFindings = "done";
  assert.match(collectionRefusal(input) ?? "", /findings/);
});

test("MCP and auto paths get the same completion check", () => {
  for (const via of ["mcp", "auto"] as const) {
    const input = eligible({ via });
    input.job.diagnosticCompletedAt = null;
    assert.notEqual(collectionRefusal(input), null, via);
  }
});

test("the voice agent can never collect", () => {
  assert.match(collectionRefusal(eligible({ via: "voice" })) ?? "", /voice agent/);
});

test("a member without billing permission cannot collect", () => {
  assert.notEqual(collectionRefusal(eligible({ actorCanBill: false })), null);
  assert.notEqual(collectionRefusal(eligible({ actorRole: null })), null);
});

test("more than the authorized amount is refused, and so is less", () => {
  assert.match(collectionRefusal(eligible({ requestedCents: 18_001 })) ?? "", /authorized/);
  assert.match(collectionRefusal(eligible({ requestedCents: 25_000 })) ?? "", /authorized/);
  assert.notEqual(collectionRefusal(eligible({ requestedCents: 9_000 })), null);
});

test("a repair under the same incomplete contract defers the fee", () => {
  const input = eligible();
  input.job.repairContract = repairContractFor("fix_now", false);
  assert.match(collectionRefusal(input) ?? "", /same contract/);
  input.job.repairContract = repairContractFor("schedule_later", false);
  assert.notEqual(collectionRefusal(input), null, "undetermined is treated as the same contract");
});

test("a genuinely separate repair contract lets the completed diagnostic be collected", () => {
  const input = eligible();
  input.job.repairContract = repairContractFor("schedule_later", true);
  assert.equal(collectionRefusal(input), null);
});

test("a larger signed contract blocks collecting the diagnostic alone", () => {
  const input = eligible();
  input.job.largerSignedContract = true;
  assert.notEqual(collectionRefusal(input), null);
});

test("no double collection", () => {
  const paid = eligible();
  paid.job.diagnosticPaid = true;
  assert.match(collectionRefusal(paid) ?? "", /already paid/);
  assert.match(collectionRefusal(eligible({ openCharge: true })) ?? "", /already processing/);
  const done = eligible();
  done.authorization!.state = "succeeded";
  assert.notEqual(collectionRefusal(done), null);
});

test("revoked, cancelled or pending authorizations are not charged", () => {
  for (const state of ["revoked", "cancelled", "expired", "setup_pending"] as const) {
    const input = eligible();
    input.authorization!.state = state;
    assert.notEqual(collectionRefusal(input), null, state);
  }
  const canceledJob = eligible();
  canceledJob.job.canceled = true;
  assert.notEqual(collectionRefusal(canceledJob), null);
});

test("tenant isolation: another business's authorization or Stripe account is refused", () => {
  const otherOrg = eligible();
  otherOrg.authorization!.organizationId = "org-b";
  assert.match(collectionRefusal(otherOrg) ?? "", /another business/);
  const otherAccount = eligible({ account: { stripeAccountId: "acct_B", chargesEnabled: true } });
  assert.match(collectionRefusal(otherAccount) ?? "", /different Stripe account/);
});

test("upfront businesses have no deferred authorization to charge", () => {
  assert.notEqual(collectionRefusal(eligible({ policy: { collectAt: "at_booking", autoCollect: false, allowManualAfterCompletion: true } })), null);
});

test("automatic collection respects the contractor's off switch", () => {
  assert.notEqual(collectionRefusal(eligible({ via: "auto", policy: { collectAt: "after_completion", autoCollect: false, allowManualAfterCompletion: true } })), null);
});

test("out-of-order webhooks never move a succeeded payment back", () => {
  assert.equal(nextAuthorizationState("succeeded", "failed"), "succeeded");
  assert.equal(nextAuthorizationState("succeeded", "requires_action"), "succeeded");
  assert.equal(nextAuthorizationState("processing", "failed"), "failed");
  assert.equal(nextAuthorizationState("failed", "succeeded"), "succeeded");
  assert.equal(nextAuthorizationState("refunded", "succeeded"), "refunded");
});

test("display states cover the lifecycle", () => {
  assert.equal(displayState({ authorizationState: null, diagnosticCompleted: false, eligible: false }), "payment_method_required");
  assert.equal(displayState({ authorizationState: "payment_method_saved", diagnosticCompleted: false, eligible: false }), "not_yet_eligible");
  assert.equal(displayState({ authorizationState: "payment_method_saved", diagnosticCompleted: true, eligible: true }), "eligible");
  assert.equal(displayState({ authorizationState: "requires_action", diagnosticCompleted: true, eligible: false }), "authentication_required");
});

test("card numbers, CVCs and Stripe identifiers are redacted", () => {
  const said = "my card is 4242 4242 4242 4242 cvc 123, pi_3Nabcdefgh and seti_1Qxyzxyzxyz, sk_live_abcdefghijkl";
  const clean = redactPaymentSecrets(said);
  assert.doesNotMatch(clean, /4242 4242/);
  assert.doesNotMatch(clean, /123/);
  assert.doesNotMatch(clean, /pi_3N|seti_1Q|sk_live/);
});

test("no invoice on a deferred diagnostic before it is completed, by any route", () => {
  const base = { deferred: true, feeCents: 18_000, followUp: false, diagnosticPaid: false, diagnosticCompletedAt: null, jobCompleted: false };
  assert.notEqual(diagnosticInvoiceRefusal(base), null);
  assert.equal(diagnosticInvoiceRefusal({ ...base, diagnosticCompletedAt: "2026-11-26T18:00:00Z" }), null);
  assert.equal(diagnosticInvoiceRefusal({ ...base, deferred: false }), null, "an upfront business keeps its own rules");
  assert.equal(diagnosticInvoiceRefusal({ ...base, followUp: true }), null, "a follow-up work order bills on its own contract");
  assert.equal(diagnosticInvoiceRefusal({ ...base, feeCents: 0 }), null);
});
