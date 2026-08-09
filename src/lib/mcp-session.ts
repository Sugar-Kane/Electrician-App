import "server-only";

import {
  readMcpSessionToken,
  signMcpSessionToken,
  type McpSession,
} from "@/lib/mcp-session-token";

/**
 * Minting and reading the URL a voice model is handed for one phone call.
 *
 * The secret is its own environment variable rather than a reused key: it
 * authorises exactly one thing — booking against one organization for one
 * caller — and a value with that small a blast radius should not be the
 * service-role key wearing a different hat.
 */

function secret(): string {
  return process.env.MCP_SESSION_SECRET ?? "";
}

export function isMcpConfigured(): boolean {
  return secret().length > 0;
}

/**
 * The MCP endpoint for one call, ready to hand to a realtime model.
 *
 * Everything the tools need to know about *who* is calling is inside the token,
 * so the model receives a URL and no arguments it could lie about.
 */
export function mcpSessionUrl(input: {
  origin: string;
  session: Omit<McpSession, "expiresAt">;
  ttlSeconds?: number;
}): string | null {
  const key = secret();
  if (!key) return null;

  const token = signMcpSessionToken({
    session: input.session,
    secret: key,
    ttlSeconds: input.ttlSeconds,
  });
  return `${input.origin.replace(/\/+$/, "")}/api/mcp/${token}`;
}

export function readSession(token: string): McpSession | null {
  return readMcpSessionToken({ token, secret: secret() });
}

/**
 * Whether the caller presented the shared bearer token, if one is required.
 *
 * Optional on purpose: the signed URL is already the credential, and this is a
 * second lock for deployments that want one. Set MCP_BEARER_TOKEN to require
 * it.
 */
export function bearerAccepted(header: string | null): boolean {
  const expected = process.env.MCP_BEARER_TOKEN ?? "";
  if (!expected) return true;
  const presented = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  return presented.length === expected.length && presented === expected;
}
