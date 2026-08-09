import test from "node:test";
import assert from "node:assert/strict";

import { publicOrigin, webhookUrlCandidates } from "./twilio-webhook-url.ts";

test("the configured origin is tried first", () => {
  const candidates = webhookUrlCandidates({
    configuredOrigin: "https://www.volteira.com",
    requestUrl: "https://internal.vercel.app/api/twilio/voice",
    host: "www.volteira.com",
  });
  assert.equal(candidates[0], "https://www.volteira.com/api/twilio/voice");
});

test("www and the bare domain are both accepted", () => {
  // The failure that took the phone line down: Twilio was configured with
  // www.volteira.com and NEXT_PUBLIC_APP_URL said volteira.com. Four
  // characters, and every call fell through to the fallback.
  const configuredWithoutWww = webhookUrlCandidates({
    configuredOrigin: "https://volteira.com",
    requestUrl: "https://volteira.com/api/twilio/voice",
  });
  assert.ok(configuredWithoutWww.includes("https://www.volteira.com/api/twilio/voice"));

  const configuredWithWww = webhookUrlCandidates({
    configuredOrigin: "https://www.volteira.com",
    requestUrl: "https://www.volteira.com/api/twilio/voice",
  });
  assert.ok(configuredWithWww.includes("https://volteira.com/api/twilio/voice"));
});

test("the proxied host is tried, because request.url can be internal", () => {
  const candidates = webhookUrlCandidates({
    requestUrl: "http://10.0.0.5:3000/api/twilio/voice",
    forwardedProto: "https",
    forwardedHost: "www.volteira.com",
  });
  assert.ok(candidates.includes("https://www.volteira.com/api/twilio/voice"));
});

test("the query string is preserved — Twilio signs it too", () => {
  const candidates = webhookUrlCandidates({
    configuredOrigin: "https://www.volteira.com",
    requestUrl: "https://www.volteira.com/api/twilio/status?message=abc-123",
  });
  assert.ok(candidates.every((candidate) => candidate.includes("?message=abc-123")), candidates.join(" "));
});

test("a proxy list takes the first hop", () => {
  const candidates = webhookUrlCandidates({
    requestUrl: "https://x.test/api/twilio/voice",
    forwardedProto: "https, http",
    forwardedHost: "www.volteira.com, internal.local",
  });
  assert.ok(candidates.includes("https://www.volteira.com/api/twilio/voice"));
});

test("the request's own URL is always a candidate", () => {
  const candidates = webhookUrlCandidates({ requestUrl: "https://x.test/api/twilio/voice" });
  assert.ok(candidates.includes("https://x.test/api/twilio/voice"));
});

test("candidates are unique, so the same string is not hashed twice", () => {
  const candidates = webhookUrlCandidates({
    configuredOrigin: "https://www.volteira.com/",
    requestUrl: "https://www.volteira.com/api/twilio/voice",
    forwardedProto: "https",
    forwardedHost: "www.volteira.com",
  });
  assert.equal(candidates.length, new Set(candidates).size);
});

test("a broken NEXT_PUBLIC_APP_URL does not take the phone line down", () => {
  const candidates = webhookUrlCandidates({
    configuredOrigin: "not a url",
    requestUrl: "https://www.volteira.com/api/twilio/voice",
  });
  assert.ok(candidates.includes("https://www.volteira.com/api/twilio/voice"));
});

test("an unparseable request URL yields nothing rather than throwing", () => {
  assert.deepEqual(webhookUrlCandidates({ requestUrl: "::::" }), []);
});

test("the origin for mid-call URLs comes from the request, not configuration", () => {
  assert.equal(
    publicOrigin({
      requestUrl: "http://10.0.0.5:3000/api/twilio/voice",
      forwardedProto: "https",
      forwardedHost: "www.volteira.com",
      fallbackOrigin: "https://wrong.example",
    }),
    "https://www.volteira.com",
  );
});

test("without proxy headers the request's own origin is used", () => {
  assert.equal(
    publicOrigin({ requestUrl: "https://www.volteira.com/api/twilio/voice" }),
    "https://www.volteira.com",
  );
});
