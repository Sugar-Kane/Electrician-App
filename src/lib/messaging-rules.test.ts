import test from "node:test";
import assert from "node:assert/strict";

import {
  blockedReasonFor,
  consentIsActive,
  deliveryStatusApplies,
  displayNameFor,
  evaluateQuietHours,
  initialsFor,
  phoneMatches,
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

test("a customer who replied STOP is refused differently from one who never opted in", () => {
  const stopped = blockedReasonFor({
    consent: { optedInAt: "2026-08-01T00:00:00Z", optedOutAt: "2026-08-02T00:00:00Z" },
    hasMessagingService: true,
  });
  assert.match(stopped ?? "", /replied STOP/);

  const never = blockedReasonFor({
    consent: { optedInAt: null, optedOutAt: null },
    hasMessagingService: true,
  });
  assert.match(never ?? "", /has not opted in/);

  assert.equal(
    blockedReasonFor({
      consent: { optedInAt: "2026-08-01T00:00:00Z", optedOutAt: null },
      hasMessagingService: true,
    }),
    null,
  );
});

test("consent is checked before the messaging service is", () => {
  // Otherwise a tenant with no service configured would be told to fix their
  // setup when the real answer is that this customer may not be texted at all.
  const reason = blockedReasonFor({
    consent: { optedInAt: null, optedOutAt: null },
    hasMessagingService: false,
  });
  assert.match(reason ?? "", /has not opted in/);
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
