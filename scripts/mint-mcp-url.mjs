#!/usr/bin/env node
/**
 * Print the MCP server URL to paste into a voice agent's configuration.
 *
 * The URL is the credential: it carries an HMAC of the organization it may book
 * for, so anyone holding it can create jobs in that business's calendar. It is
 * generated here, on your own machine, so the signing secret never has to be
 * pasted anywhere it could be read later.
 *
 *   MCP_SESSION_SECRET=... APP_URL=https://www.example.com \
 *     node scripts/mint-mcp-url.mjs <organization-id> [days]
 *
 * Rotating MCP_SESSION_SECRET invalidates every URL ever minted, which is the
 * revocation story: change the secret, mint again, paste again.
 */

import { signMcpSessionToken } from "../src/lib/mcp-session-token.ts";

const [organizationId, days = "180"] = process.argv.slice(2);
const secret = process.env.MCP_SESSION_SECRET ?? "";
const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");

if (!organizationId || !secret || !appUrl) {
  console.error(
    "Usage: MCP_SESSION_SECRET=... APP_URL=https://... node scripts/mint-mcp-url.mjs <organization-id> [days]",
  );
  process.exit(1);
}

const ttlSeconds = Math.round(Number(days) * 24 * 60 * 60);
if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
  console.error("days must be a positive number.");
  process.exit(1);
}

const token = signMcpSessionToken({
  session: { organizationId },
  secret,
  ttlSeconds,
});

console.log(`${appUrl}/api/mcp/${token}`);
console.error(`Expires ${new Date(Date.now() + ttlSeconds * 1000).toDateString()}.`);
