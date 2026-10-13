import test from "node:test";
import assert from "node:assert/strict";

import {
  bearerWebsiteKey,
  hashWebsiteKey,
  newWebsiteKey,
  parseWebsiteRequest,
  websiteOpenerFallback,
  websiteTextDecision,
} from "./website-intake.ts";

const request = {
  reference: "8d6f0c4e-2b1a-4c3d-9e8f-7a6b5c4d3e2f",
  firstName: "Jane",
  lastName: "Doe",
  phone: "(805) 555-0142",
  email: "jane@example.test",
  address: "12 Elm St",
  city: "Springfield",
  postalCode: "93401",
  service: "panel-upgrades",
  serviceName: "Electrical Panels & Breakers",
  description: "Breaker trips when the dryer runs",
  preferredTimes: "Weekday mornings",
  contactMethod: "text",
  smsConsent: true,
  smsDisclosure: "I agree to receive transactional text messages from Pacific Plains Electric. Reply STOP to opt out.",
  site: "pacificplainselectric.com",
};

test("a website key is long and random, and only a well-formed bearer key is read", () => {
  const key = newWebsiteKey();
  assert.match(key, /^vwk_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newWebsiteKey(), key, "two keys are never the same");
  assert.equal(bearerWebsiteKey(`Bearer ${key}`), key);
  assert.equal(bearerWebsiteKey(key), null, "the scheme is required");
  assert.equal(bearerWebsiteKey(`Bearer ${key.slice(0, -1)}`), null, "a truncated key is refused");
  assert.equal(bearerWebsiteKey("Bearer vwk_' or 1=1 --"), null);
  assert.equal(bearerWebsiteKey(null), null);
  assert.match(hashWebsiteKey(key), /^[0-9a-f]{64}$/, "only the SHA-256 is stored");
  assert.notEqual(hashWebsiteKey(key), key);
});

test("consent to texts is only taken with the words it was given against", () => {
  const parsed = parseWebsiteRequest(request);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.ok && parsed.request.smsConsent, true);

  assert.deepEqual(
    parseWebsiteRequest({ ...request, smsDisclosure: "" }),
    { ok: false, error: "Text consent needs the wording the customer agreed to." },
  );

  // Anything but a real `true` is not a ticked box, and the wording is dropped with it.
  for (const value of ["true", 1, "yes", null, undefined]) {
    const loose = parseWebsiteRequest({ ...request, smsConsent: value });
    assert.equal(loose.ok && loose.request.smsConsent, false, `${String(value)} is not consent`);
    assert.equal(loose.ok && loose.request.smsDisclosure, "");
  }
});

test("a request needs a reference, a name and a usable phone number", () => {
  assert.equal(parseWebsiteRequest({ ...request, reference: "" }).ok, false);
  assert.equal(parseWebsiteRequest({ ...request, reference: "../../etc" }).ok, false);
  assert.equal(parseWebsiteRequest({ ...request, firstName: "  " }).ok, false);
  assert.equal(parseWebsiteRequest({ ...request, phone: "555-0142" }).ok, false);
  assert.equal(parseWebsiteRequest([request]).ok, false);
  assert.equal(parseWebsiteRequest(null).ok, false);
});

test("the assistant texts once, only with consent, never after a STOP", () => {
  const fresh = { duplicate: false, consent: "recorded" as const, consentActiveNow: true, textingConfigured: true };
  assert.deepEqual(websiteTextDecision(fresh), { send: true });
  assert.deepEqual(websiteTextDecision({ ...fresh, consent: "existing" }), { send: true }, "consent from an earlier text counts");

  assert.deepEqual(websiteTextDecision({ ...fresh, duplicate: true }), { send: false, reason: "duplicate" }, "a resent request texts nobody");
  assert.deepEqual(websiteTextDecision({ ...fresh, consent: "unchanged" }), { send: false, reason: "duplicate" });
  assert.deepEqual(websiteTextDecision({ ...fresh, consent: "none" }), { send: false, reason: "no_consent" });
  assert.deepEqual(
    websiteTextDecision({ ...fresh, consent: "opted_out" }),
    { send: false, reason: "opted_out" },
    "ticking a box on a website does not undo a STOP",
  );
  assert.deepEqual(
    websiteTextDecision({ ...fresh, consentActiveNow: false }),
    { send: false, reason: "opted_out" },
    "a STOP that lands after the request is saved still wins",
  );
  assert.deepEqual(websiteTextDecision({ ...fresh, textingConfigured: false }), { send: false, reason: "texting_not_set_up" });
});

test("the first text says who is writing and how to stop", () => {
  for (const hasAddress of [true, false]) {
    const text = websiteOpenerFallback({ businessName: "Pacific Plains Electric", firstName: "Jane", hasAddress });
    assert.match(text, /Pacific Plains Electric/);
    assert.match(text, /Reply STOP to opt out\./);
  }
});
