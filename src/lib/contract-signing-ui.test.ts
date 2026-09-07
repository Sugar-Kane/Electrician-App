import test from "node:test";
import assert from "node:assert/strict";

import {
  isContractSignatureRecovery,
  showsContractSigningSection,
} from "./contract-signing-ui.ts";

const readyDraft = {
  current: true,
  status: "draft" as const,
  hasDocument: true,
  unfilledCount: 0,
  documentMatchesContract: true,
  signatureEnvelopeLinked: false,
};

test("a current complete draft can be sent", () => {
  assert.equal(showsContractSigningSection(readyDraft), true);
  assert.equal(isContractSignatureRecovery(readyDraft), false);
});

test("an ordinary superseded draft cannot be sent", () => {
  assert.equal(showsContractSigningSection({ ...readyDraft, current: false }), false);
});

test("a superseded provider-linked draft keeps its recovery action", () => {
  const supersededRecovery = {
    ...readyDraft,
    current: false,
    hasDocument: false,
    signatureEnvelopeLinked: true,
  };

  assert.equal(showsContractSigningSection(supersededRecovery), true);
  assert.equal(isContractSignatureRecovery(supersededRecovery), true);
});

test("a stale current PDF cannot be newly sent", () => {
  assert.equal(
    showsContractSigningSection({ ...readyDraft, documentMatchesContract: false }),
    false,
  );
});

test("sent and signed contracts retain their status controls", () => {
  assert.equal(showsContractSigningSection({ ...readyDraft, current: false, status: "sent" }), true);
  assert.equal(
    showsContractSigningSection({ ...readyDraft, current: false, status: "signed" }),
    true,
  );
});
