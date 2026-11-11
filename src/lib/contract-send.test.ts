import test from "node:test";
import assert from "node:assert/strict";

import { RESEND_GAP_MS, contractSendRefusal, type ContractSendFacts } from "./contract-send.ts";

const now = Date.parse("2026-11-11T04:00:00Z");

function facts(overrides: Partial<ContractSendFacts> = {}, contract: Partial<NonNullable<ContractSendFacts["contract"]>> = {}): ContractSendFacts {
  return {
    contract: { status: "draft", signedAt: null, signatureProvider: null, unfilled: [], signatureSentAt: null, ...contract },
    signerReady: true,
    textingAllowed: true,
    hasMessagingService: true,
    now,
    ...overrides,
  };
}

test("a ready contract for a consenting customer may be sent", () => {
  assert.equal(contractSendRefusal(facts()), "");
});

test("no contract on the job is refused", () => {
  assert.match(contractSendRefusal(facts({ contract: null })), /no contract/);
});

test("a signed, cancelled or emailed contract is never re-sent", () => {
  assert.match(contractSendRefusal(facts({}, { signedAt: "2026-11-10T00:00:00Z" })), /already been signed/);
  assert.match(contractSendRefusal(facts({}, { status: "void" })), /cancelled/);
  assert.match(contractSendRefusal(facts({}, { signatureProvider: "documenso" })), /email/);
});

test("a contract with blanks left is not sent for signature", () => {
  assert.match(contractSendRefusal(facts({}, { unfilled: ["price"] })), /1 detail is still/);
});

test("the same link is not texted twice within a minute", () => {
  const recent = new Date(now - RESEND_GAP_MS / 2).toISOString();
  assert.match(contractSendRefusal(facts({}, { signatureSentAt: recent })), /less than a minute/);
  const earlier = new Date(now - RESEND_GAP_MS - 1000).toISOString();
  assert.equal(contractSendRefusal(facts({}, { signatureSentAt: earlier })), "");
});

test("the business must be able to sign first", () => {
  assert.match(contractSendRefusal(facts({ signerReady: false })), /no saved signature/);
});

test("no SMS consent means no text, whatever else is ready", () => {
  const refusal = contractSendRefusal(facts({ textingAllowed: false, textingRefusal: "The customer does not have active SMS consent." }));
  assert.match(refusal, /does not have active SMS consent/);
  assert.match(refusal, /not sent/);
});

test("texting not set up for the business is refused", () => {
  assert.match(contractSendRefusal(facts({ hasMessagingService: false })), /not set up/);
});
