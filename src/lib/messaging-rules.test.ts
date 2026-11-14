import test from "node:test";
import assert from "node:assert/strict";

import {
  blockedReasonFor,
  textRefusal,
  callbackConsentStep,
  consentIsActive,
  deliveryStatusApplies,
  displayNameFor,
  evaluateQuietHours,
  firstTextOptsIn,
  inboxFingerprint,
  initialsFor,
  manualConsentStep,
  phoneMatches,
  threadFingerprint,
} from "./messaging-rules.ts";

// 2026-08-07T18:00:00Z is 11:00 in Los Angeles and 04:00 the next day in Sydney,
// which is what makes it useful for pinning the timezone handling down.
const MIDDAY_UTC = new Date("2026-08-07T18:00:00Z");

test("consent needs an opt-in that has not been withdrawn", () => {
  assert.equal(consentIsActive({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: null }), true);
  assert.equal(consentIsActive({ optedInAt: null, optedOutAt: null }), false);
  assert.equal(
    consentIsActive({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: "2026-08-02T00:00:00Z" }),
    false,
    "a STOP after an opt-in wins",
  );
});

test("a callback confirmation never undoes a STOP, and records consent only when none is on file", () => {
  assert.deepEqual(callbackConsentStep(null), { record: true, mayText: true }, "a first-time caller is recorded, then texted");
  assert.deepEqual(
    callbackConsentStep({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: null }),
    { record: false, mayText: true },
    "an existing opt-in is left as it is",
  );
  const stopped = callbackConsentStep({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: "2026-08-02T00:00:00Z" });
  assert.equal(stopped.mayText, false, "a customer who replied STOP is not texted");
  assert.equal(stopped.record, false, "and their opt-out is not overwritten");
  assert.deepEqual(
    callbackConsentStep({ optedInAt: null, optedOutAt: null }),
    { record: true, mayText: true },
    "a row with neither date is not consent until recorded",
  );
});

test("a customer on file who texts first opts in, but never over a STOP", () => {
  assert.equal(firstTextOptsIn(null), true, "nothing on file: their own text is the opt-in");
  assert.equal(firstTextOptsIn({ optedInAt: null, optedOutAt: null }), true, "an empty row is the same as none");
  assert.equal(
    firstTextOptsIn({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: "2026-08-02T00:00:00Z" }),
    false,
    "a STOP stands until they text START",
  );
  assert.equal(firstTextOptsIn({ optedInAt: null, optedOutAt: "2026-08-02T00:00:00Z" }), false, "an opt-out with no opt-in also stands");
  assert.equal(firstTextOptsIn({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: null }), false, "an active opt-in needs nothing written");
});

test("consent recorded when the owner enters a number is written only where nothing is on file, and never over a STOP", () => {
  assert.deepEqual(manualConsentStep(null), { write: "insert", already: false }, "nothing on file: a new row");
  assert.deepEqual(manualConsentStep({ optedInAt: null, optedOutAt: null }), { write: "update", already: false }, "an empty row is filled");
  assert.deepEqual(manualConsentStep({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: null }), { write: null, already: true });
  const stopped = manualConsentStep({ optedInAt: "2026-08-01T00:00:00Z", optedOutAt: "2026-08-02T00:00:00Z" });
  assert.equal(stopped.write, null, "a STOP stands");
  assert.match("refused" in stopped ? stopped.refused : "", /START/);
  const stoppedOnly = manualConsentStep({ optedInAt: null, optedOutAt: "2026-08-02T00:00:00Z" });
  assert.equal(stoppedOnly.write, null, "a STOP with no opt-in also stands");
});

test("only a STOP refuses a text: the one rule every text goes through", () => {
  assert.equal(textRefusal(null), null, "no record does not stop the business texting about the job");
  assert.equal(textRefusal({ optedInAt: null, optedOutAt: null }), null);
  assert.equal(textRefusal("unknown"), null, "an unreadable record is not a STOP; the carrier's own list still blocks one");
  assert.equal(textRefusal({ optedInAt: "2026-09-01T00:00:00Z", optedOutAt: null }), null);
  assert.match(textRefusal({ optedInAt: "2026-09-01T00:00:00Z", optedOutAt: "2026-09-02T00:00:00Z" }) ?? "", /STOP/);
  assert.match(textRefusal({ optedInAt: null, optedOutAt: "2026-09-02T00:00:00Z" }) ?? "", /STOP/);
  assert.equal(textRefusal({ optedInAt: "2026-09-03T00:00:00Z", optedOutAt: "2026-09-02T00:00:00Z" }), null, "START after STOP");
});

test("the inbox composer follows the same rule: only a STOP blocks it", () => {
  const stopped = blockedReasonFor({
    consent: { optedInAt: "2026-08-01T00:00:00Z", optedOutAt: "2026-08-02T00:00:00Z" },
    hasMessagingService: true,
  });
  assert.match(stopped ?? "", /replied STOP/);

  assert.equal(blockedReasonFor({ consent: { optedInAt: null, optedOutAt: null }, hasMessagingService: true }), null);
  assert.equal(
    blockedReasonFor({ consent: { optedInAt: "2026-08-01T00:00:00Z", optedOutAt: null }, hasMessagingService: true }),
    null,
  );
});

test("a STOP is reported before a missing messaging service", () => {
  // Otherwise a tenant with no service configured would be told to fix their
  // setup when the real answer is that this customer may not be texted at all.
  const reason = blockedReasonFor({
    consent: { optedInAt: null, optedOutAt: "2026-08-02T00:00:00Z" },
    hasMessagingService: false,
  });
  assert.match(reason ?? "", /replied STOP/);
});

test("quiet hours wrap around midnight", () => {
  const quiet = (at: string) =>
    evaluateQuietHours("21:00:00", "08:00:00", "UTC", new Date(at)).currentlyQuiet;

  assert.equal(quiet("2026-08-07T22:30:00Z"), true, "after the start, before midnight");
  assert.equal(quiet("2026-08-08T02:00:00Z"), true, "after midnight, before the end");
  assert.equal(quiet("2026-08-08T07:59:00Z"), true, "the last minute of the window");
  assert.equal(quiet("2026-08-08T08:00:00Z"), false, "the window is exclusive at the end");
  assert.equal(quiet("2026-08-07T20:59:00Z"), false, "one minute before it starts");
  assert.equal(quiet("2026-08-07T12:00:00Z"), false, "the middle of the working day");
});

test("quiet hours also handle a window inside one day", () => {
  const quiet = (at: string) =>
    evaluateQuietHours("12:00:00", "13:00:00", "UTC", new Date(at)).currentlyQuiet;

  assert.equal(quiet("2026-08-07T12:30:00Z"), true);
  assert.equal(quiet("2026-08-07T11:59:00Z"), false);
  assert.equal(quiet("2026-08-07T13:00:00Z"), false);
});

test("quiet hours are judged in the business timezone, not the server's", () => {
  // 18:00 UTC is 11:00 in Los Angeles — working hours — and 04:00 in Sydney,
  // which is the middle of the quiet window.
  assert.equal(
    evaluateQuietHours("21:00:00", "08:00:00", "America/Los_Angeles", MIDDAY_UTC).currentlyQuiet,
    false,
  );
  assert.equal(
    evaluateQuietHours("21:00:00", "08:00:00", "Australia/Sydney", MIDDAY_UTC).currentlyQuiet,
    true,
  );
});

test("commercial customers keep their company name", () => {
  assert.equal(
    displayNameFor({ first_name: null, last_name: null, company_name: "Harbor Freight Yard" }),
    "Harbor Freight Yard",
  );
  assert.equal(initialsFor({ first_name: null, last_name: null, company_name: "Harbor Freight" }), "HA");
});

test("people are named before companies when both are present", () => {
  assert.equal(
    displayNameFor({ first_name: "Ada", last_name: "Byron", company_name: "Byron Electrical" }),
    "Ada Byron",
  );
  assert.equal(
    initialsFor({ first_name: "Ada", last_name: "Byron", company_name: "Byron Electrical" }),
    "AB",
  );
});

test("a customer with no name at all does not crash the list", () => {
  assert.equal(displayNameFor({}), "Unknown customer");
  assert.equal(initialsFor({}), "?");
  assert.equal(displayNameFor({ first_name: "Ada", last_name: null }), "Ada");
});

test("phone matching survives formatting and country codes", () => {
  assert.equal(phoneMatches("(805) 555-0123", "+18055550123"), true);
  assert.equal(phoneMatches("805-555-0123", "8055550123"), true);
  assert.equal(phoneMatches("8055550123", "+18055550124"), false);
});

test("phone matching refuses to match on too few digits", () => {
  // Without the length guard a customer row with a short or empty number would
  // match anyone whose number ends the same way.
  assert.equal(phoneMatches("", "+18055550123"), false);
  assert.equal(phoneMatches("5550123", "+18055550123"), false);
});

test("a late sent callback cannot walk a message backwards", () => {
  assert.equal(deliveryStatusApplies("sent", "queued"), true);
  assert.equal(deliveryStatusApplies("sent", "sending"), true);
  assert.equal(deliveryStatusApplies("sent", "delivered"), false, "delivered is further along");
  assert.equal(deliveryStatusApplies("sent", "failed"), false, "failed is terminal");
});

test("delivered and failed always apply", () => {
  assert.equal(deliveryStatusApplies("delivered", "sent"), true);
  assert.equal(deliveryStatusApplies("failed", "sent"), true);
  assert.equal(deliveryStatusApplies("undelivered", "sent"), true);
});

test("a thread's fingerprint moves when a message arrives or changes status", () => {
  const sent = [
    { id: "m1", status: "received" },
    { id: "m2", status: "sent" },
  ];
  const before = threadFingerprint(sent);

  assert.equal(threadFingerprint([...sent]), before, "the same rows are the same state");
  assert.notEqual(
    threadFingerprint([...sent, { id: "m3", status: "received" }]),
    before,
    "a reply is a change",
  );
  assert.notEqual(
    threadFingerprint([sent[0], { id: "m2", status: "delivered" }]),
    before,
    "sent turning into delivered is a change",
  );
});

test("a thread's fingerprint ignores the order the rows came back in", () => {
  const rows = [
    { id: "m1", status: "received" },
    { id: "m2", status: "delivered" },
    { id: "m3", status: "received" },
  ];
  assert.equal(threadFingerprint(rows), threadFingerprint([rows[2], rows[0], rows[1]]));
});

test("a fingerprint cannot be fooled by where one entry ends and the next begins", () => {
  assert.notEqual(
    threadFingerprint([{ id: "ab", status: "c" }, { id: "d", status: "e" }]),
    threadFingerprint([{ id: "a", status: "bc" }, { id: "d", status: "e" }]),
  );
  assert.notEqual(threadFingerprint([]), threadFingerprint([{ id: "m1", status: "sent" }]));
});

test("the inbox fingerprint moves when a thread moves, arrives or leaves", () => {
  const inbox = [
    { id: "c1", lastMessageAt: "2026-09-30T00:49:15.792+00:00", status: "open" },
    { id: "c2", lastMessageAt: null, status: "open" },
  ];
  const before = inboxFingerprint(inbox);

  assert.equal(inboxFingerprint([inbox[1], inbox[0]]), before);
  assert.notEqual(
    inboxFingerprint([{ ...inbox[0], lastMessageAt: "2026-09-30T00:50:31.744+00:00" }, inbox[1]]),
    before,
    "a new text on a thread",
  );
  assert.notEqual(
    inboxFingerprint([{ ...inbox[0], status: "needs_human" }, inbox[1]]),
    before,
    "a thread that now wants a person",
  );
  assert.notEqual(inboxFingerprint([inbox[0]]), before, "a thread archived elsewhere");
});
