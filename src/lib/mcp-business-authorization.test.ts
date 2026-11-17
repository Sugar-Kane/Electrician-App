import assert from "node:assert/strict";
import { test } from "node:test";

import { authorizeBusinessMcpConnection, type BusinessConnectionLookups } from "./mcp-business-authorization.ts";

/*
 * A ChatGPT business connection acts for a whole business. It may only while
 * its credential is a live one of that same business and the owner who made it
 * is still an owner there.
 */

const A = "a1000000-0000-4000-8000-00000000000a";
const B = "b1000000-0000-4000-8000-00000000000b";
const OWNER_A = "a0000000-0000-4000-8000-00000000000a";
const NOW = new Date("2026-11-17T12:00:00Z");
const LATER = "2027-05-01T00:00:00Z";

type Credential = { id: string; organizationId: string; createdBy: string; revokedAt: string | null; expiresAt: string | null };

function lookups(credentials: Credential[], members: { organizationId: string; userId: string; role: string }[]): BusinessConnectionLookups {
  return {
    async credential(credentialId, organizationId) {
      const found = credentials.find((entry) => entry.id === credentialId && entry.organizationId === organizationId);
      return found ? { createdBy: found.createdBy, revokedAt: found.revokedAt, expiresAt: found.expiresAt } : null;
    },
    async memberRole(organizationId, userId) {
      return members.find((entry) => entry.organizationId === organizationId && entry.userId === userId)?.role ?? null;
    },
  };
}

const live: Credential = { id: "cred-a", organizationId: A, createdBy: OWNER_A, revokedAt: null, expiresAt: LATER };
const owners = [{ organizationId: A, userId: OWNER_A, role: "owner" }];

test("a live credential made by a current owner may act", async () => {
  const verdict = await authorizeBusinessMcpConnection({ scope: "business", organizationId: A, credentialId: "cred-a" }, lookups([live], owners), NOW);
  assert.deepEqual(verdict, { ok: true, connectedBy: OWNER_A });
});

test("a credential cannot act for another business, even with a valid signature naming it", async () => {
  const verdict = await authorizeBusinessMcpConnection({ scope: "business", organizationId: B, credentialId: "cred-a" }, lookups([live], owners), NOW);
  assert.equal(verdict.ok, false);
});

test("revoked, expired, missing and unknown credentials are refused", async () => {
  const cases: [Credential[], string | null][] = [
    [[{ ...live, revokedAt: "2026-11-01T00:00:00Z" }], "cred-a"],
    [[{ ...live, expiresAt: "2026-11-17T11:59:59Z" }], "cred-a"],
    [[{ ...live, expiresAt: null }], "cred-a"],
    [[live], "cred-unknown"],
    [[live], null],
    [[live], ""],
  ];
  for (const [credentials, credentialId] of cases) {
    const verdict = await authorizeBusinessMcpConnection({ scope: "business", organizationId: A, credentialId }, lookups(credentials, owners), NOW);
    assert.equal(verdict.ok, false, JSON.stringify({ credentials, credentialId }));
  }
});

test("an owner who was removed or demoted takes the connection with them", async () => {
  const removed = await authorizeBusinessMcpConnection({ scope: "business", organizationId: A, credentialId: "cred-a" }, lookups([live], []), NOW);
  assert.equal(removed.ok, false);
  const demoted = await authorizeBusinessMcpConnection(
    { scope: "business", organizationId: A, credentialId: "cred-a" },
    lookups([live], [{ organizationId: A, userId: OWNER_A, role: "admin" }]),
    NOW,
  );
  assert.equal(demoted.ok, false);
  // Being an owner of a different business does not count.
  const elsewhere = await authorizeBusinessMcpConnection(
    { scope: "business", organizationId: A, credentialId: "cred-a" },
    lookups([live], [{ organizationId: B, userId: OWNER_A, role: "owner" }]),
    NOW,
  );
  assert.equal(elsewhere.ok, false);
});

test("a booking link is never a business connection", async () => {
  const verdict = await authorizeBusinessMcpConnection({ scope: "booking", organizationId: A, credentialId: "cred-a" }, lookups([live], owners), NOW);
  assert.equal(verdict.ok, false);
});

test("two businesses' connections are judged independently, at the same time", async () => {
  const OWNER_B = "b0000000-0000-4000-8000-00000000000b";
  const credentials: Credential[] = [live, { id: "cred-b", organizationId: B, createdBy: OWNER_B, revokedAt: null, expiresAt: LATER }];
  const members = [...owners, { organizationId: B, userId: OWNER_B, role: "owner" }];
  const [a, b, crossed] = await Promise.all([
    authorizeBusinessMcpConnection({ scope: "business", organizationId: A, credentialId: "cred-a" }, lookups(credentials, members), NOW),
    authorizeBusinessMcpConnection({ scope: "business", organizationId: B, credentialId: "cred-b" }, lookups(credentials, members), NOW),
    authorizeBusinessMcpConnection({ scope: "business", organizationId: A, credentialId: "cred-b" }, lookups(credentials, members), NOW),
  ]);
  assert.deepEqual(a, { ok: true, connectedBy: OWNER_A });
  assert.deepEqual(b, { ok: true, connectedBy: OWNER_B });
  assert.equal(crossed.ok, false);
});
