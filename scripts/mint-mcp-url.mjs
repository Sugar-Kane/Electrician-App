#!/usr/bin/env node
/**
 * Print a signed MCP server URL.
 *
 * booking (default): public-facing receptionist tools only.
 * business: owner/ChatGPT tools for customers, hours, reports, invoices,
 * messages, contracts and suppliers.
 *
 *   MCP_SESSION_SECRET=... APP_URL=https://www.example.com \
 *     node scripts/mint-mcp-url.mjs <organization-id> [days] [booking|business]
 *
 * The URL is a credential. Keep business URLs private. Rotating
 * MCP_SESSION_SECRET invalidates every URL minted with the old secret.
 */

import { signMcpSessionToken } from "../src/lib/mcp-session-token.ts";

const [organizationId, days = "180", requestedScope = "booking"] = process.argv.slice(2);
const secret = process.env.MCP_SESSION_SECRET ?? "";
const appUrl = (process.env.APP_URL ?? "").replace(/\/+$/, "");
const scope = requestedScope === "business" ? "business" : requestedScope === "booking" ? "booking" : "";

if (!organizationId || !secret || !appUrl || !scope) {
  console.error(
    "Usage: MCP_SESSION_SECRET=... APP_URL=https://... node scripts/mint-mcp-url.mjs <organization-id> [days] [booking|business]",
  );
  process.exit(1);
}

const ttlSeconds = Math.round(Number(days) * 24 * 60 * 60);
if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
  console.error("days must be a positive number.");
  process.exit(1);
}

const token = signMcpSessionToken({
  session: { organizationId, scope },
  secret,
  ttlSeconds,
});

console.log(`${appUrl}/api/mcp/${token}`);
console.error(`${scope} scope; expires ${new Date(Date.now() + ttlSeconds * 1000).toDateString()}.`);
