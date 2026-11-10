import test from "node:test";
import assert from "node:assert/strict";

import { contentSecurityPolicy, newNonce } from "./csp.ts";

test("scripts need this response's nonce", () => {
  const policy = contentSecurityPolicy({ nonce: "abc123", preview: false });
  const script = policy.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
  assert.ok(script.includes("'nonce-abc123'"));
  assert.ok(script.includes("'strict-dynamic'"));
  assert.ok(policy.includes("object-src 'none'"));
  assert.ok(policy.includes("base-uri 'self'"));
  assert.ok(policy.includes("frame-ancestors 'none'"));
});

test("only previews may be framed, and only by Vercel's toolbar", () => {
  assert.ok(contentSecurityPolicy({ nonce: "n", preview: true }).includes("frame-ancestors 'self' https://vercel.live"));
});

test("every nonce is new and long enough not to guess", () => {
  const seen = new Set(Array.from({ length: 200 }, () => newNonce()));
  assert.equal(seen.size, 200);
  for (const nonce of seen) assert.ok(Buffer.from(nonce, "base64").length >= 16);
});
