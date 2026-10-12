import test from "node:test";
import assert from "node:assert/strict";

import { recipientCorrection, retryKey, retryRefusal, sendOutcome, textFingerprint, type TextFacts } from "./text-recovery.ts";

const ORG = "org-1";
// 3 PM in Chicago: outside the default 21:00–08:00 quiet hours.
const NOW = new Date("2026-10-12T20:00:00Z");

function facts(overrides: Partial<TextFacts> = {}): TextFacts {
  return {
    organizationId: ORG,
    message: {
      id: "m1",
      organizationId: ORG,
      direction: "outbound",
      status: "failed",
      errorCode: "30003",
      body: "Running 10 minutes late",
      createdAt: "2026-10-12T19:00:00Z",
      updatedAt: "2026-10-12T19:01:00Z",
      providerMessageId: "SM1",
    },
    customer: { id: "c1", name: "Sarah", phone: "(805) 555-0142" },
    consent: { optedInAt: "2026-10-01T00:00:00Z", optedOutAt: null },
    job: { jobNumber: "1042", status: "en_route" },
    messaging: { serviceSid: "MG1", quietStart: "21:00:00", quietEnd: "08:00:00", timezone: "America/Chicago" },
    laterSends: [],
    recipientFixedAt: "",
    operations: [],
    ...overrides,
  };
}

test("a text that failed for a reason sending again can fix is offered", () => {
  assert.equal(retryRefusal(facts(), NOW), null);
});

test("a text from another business is refused", () => {
  assert.match(retryRefusal(facts({ organizationId: "org-2" }), NOW)!, /another business/);
});

test("a customer who replied STOP, or never agreed, is never texted again", () => {
  assert.match(retryRefusal(facts({ consent: { optedInAt: "2026-10-01T00:00:00Z", optedOutAt: "2026-10-12T19:30:00Z" } }), NOW)!, /STOP/);
  assert.match(retryRefusal(facts({ consent: { optedInAt: null, optedOutAt: null } }), NOW)!, /hasn't agreed/);
});

test("a cancelled or completed job's text is not sent again", () => {
  assert.match(retryRefusal(facts({ job: { jobNumber: "1042", status: "canceled" } }), NOW)!, /cancelled/);
  assert.match(retryRefusal(facts({ job: { jobNumber: "1042", status: "completed" } }), NOW)!, /completed/);
});

test("the same words having gone since, or a retry already made, stops a duplicate", () => {
  assert.match(retryRefusal(facts({ laterSends: [{ status: "delivered", sameBody: true }] }), NOW)!, /duplicate/);
  assert.match(retryRefusal(facts({ operations: [{ tool: "retry_text", state: "accepted" }] }), NOW)!, /already been sent again/);
  // An earlier retry whose outcome nobody knows must be checked, not repeated.
  assert.match(retryRefusal(facts({ operations: [{ tool: "retry_text", state: "unknown" }] }), NOW)!, /isn't known/);
  // A different text sent since is not a duplicate of this one.
  assert.equal(retryRefusal(facts({ laterSends: [{ status: "delivered", sameBody: false }] }), NOW), null);
});

test("a wrong number is refused until the number is corrected", () => {
  const invalid = facts({ message: { ...facts().message, errorCode: "21211" } });
  assert.match(retryRefusal(invalid, NOW)!, /correct the customer's number first/);
  assert.equal(retryRefusal({ ...invalid, recipientFixedAt: "2026-10-12T19:30:00Z" }, NOW), null);
  // An opt-out at the carrier is never fixed by a new number.
  const stop = facts({ message: { ...facts().message, errorCode: "21610" }, recipientFixedAt: "2026-10-12T19:30:00Z" });
  assert.match(retryRefusal(stop, NOW)!, /replied STOP/);
});

test("only failed texts the business sent can be retried", () => {
  assert.match(retryRefusal(facts({ message: { ...facts().message, status: "delivered" } }), NOW)!, /didn't fail/);
  assert.match(retryRefusal(facts({ message: { ...facts().message, direction: "inbound" } }), NOW)!, /business sent/);
});

test("quiet hours wait until morning", () => {
  const late = new Date("2026-10-13T04:00:00Z"); // 11 PM in Chicago
  assert.match(retryRefusal(facts(), late)!, /quiet hours/);
});

test("anything the preview showed changing makes the fingerprint change", () => {
  const base = textFingerprint(facts());
  assert.notEqual(textFingerprint(facts({ customer: { id: "c1", name: "Sarah", phone: "8055550199" } })), base);
  assert.notEqual(textFingerprint(facts({ consent: { optedInAt: "2026-10-01T00:00:00Z", optedOutAt: "2026-10-12T19:30:00Z" } })), base);
  assert.notEqual(textFingerprint(facts({ message: { ...facts().message, status: "delivered" } })), base);
  assert.equal(textFingerprint(facts()), base);
});

test("two admins retrying at once build the same claim, so only one goes", () => {
  assert.equal(retryKey("m1", []), retryKey("m1", []));
  assert.notEqual(retryKey("m1", [{ tool: "retry_text" }]), retryKey("m1", []));
});

test("no answer from the provider is unknown, never failed or sent", () => {
  assert.equal(sendOutcome({ ok: true }), "accepted");
  assert.equal(sendOutcome({ ok: false, errorCode: "30003" }), "failed");
  assert.equal(sendOutcome({ ok: false, errorCode: "network_error" }), "unknown");
});

test("a corrected number must be textable and different", () => {
  assert.deepEqual(recipientCorrection("(805) 555-0142", "805 555 0199"), { ok: true, number: "+18055550199" });
  assert.equal(recipientCorrection("(805) 555-0142", "+1 805-555-0142").ok, false);
  assert.equal(recipientCorrection("(805) 555-0142", "555").ok, false);
});
