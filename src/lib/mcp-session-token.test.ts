import test from "node:test";
import assert from "node:assert/strict";

import { readMcpSessionToken, signMcpSessionToken } from "./mcp-session-token.ts";

const SECRET = "a-secret-that-is-not-the-service-role-key";
const SESSION = {
  organizationId: "11111111-1111-1111-1111-111111111111",
  customerId: "22222222-2222-2222-2222-222222222222",
  phone: "+18055550142",
};

test("a token round-trips to the session it was signed for", () => {
  const token = signMcpSessionToken({ session: SESSION, secret: SECRET });
  const read = readMcpSessionToken({ token, secret: SECRET });

  assert.equal(read?.organizationId, SESSION.organizationId);
  assert.equal(read?.customerId, SESSION.customerId);
  assert.equal(read?.phone, SESSION.phone);
});

test("another deployment's secret does not open it", () => {
  const token = signMcpSessionToken({ session: SESSION, secret: SECRET });
  assert.equal(readMcpSessionToken({ token, secret: "different" }), null);
});

test("editing the organization out of the payload breaks the signature", () => {
  // The whole reason the tenant is in the token rather than in a tool argument.
  const token = signMcpSessionToken({ session: SESSION, secret: SECRET });
  const [, signature] = token.split(".");

  const forged = Buffer.from(
    JSON.stringify({ ...SESSION, organizationId: "someone-else", expiresAt: 9_999_999_999 }),
    "utf-8",
  ).toString("base64url");

  assert.equal(readMcpSessionToken({ token: `${forged}.${signature}`, secret: SECRET }), null);
});

test("a token stops working once the call is long over", () => {
  const signedAt = new Date("2026-08-09T10:00:00Z");
  const token = signMcpSessionToken({
    session: SESSION,
    secret: SECRET,
    ttlSeconds: 3600,
    now: signedAt,
  });

  assert.ok(readMcpSessionToken({ token, secret: SECRET, now: new Date("2026-08-09T10:59:00Z") }));
  assert.equal(
    readMcpSessionToken({ token, secret: SECRET, now: new Date("2026-08-09T11:01:00Z") }),
    null,
  );
});

test("no secret means no session, rather than an unsigned one", () => {
  const token = signMcpSessionToken({ session: SESSION, secret: SECRET });
  assert.equal(readMcpSessionToken({ token, secret: "" }), null);
});

test("malformed tokens are refused rather than thrown on", () => {
  for (const token of ["", ".", "a.b", "not-a-token", "a.b.c", "!!!.???"]) {
    assert.equal(readMcpSessionToken({ token, secret: SECRET }), null, token);
  }
});

test("a session missing a customer is not a session", () => {
  const token = signMcpSessionToken({
    session: { ...SESSION, customerId: "" },
    secret: SECRET,
  });
  assert.equal(readMcpSessionToken({ token, secret: SECRET }), null);
});
