import "server-only";

import {
  readMcpSessionToken,
  signMcpSessionToken,
  type McpScope,
  type McpSession,
} from "@/lib/mcp-session-token";

/**
 * Minting and reading signed MCP URLs.
 *
 * Existing phone/receptionist callers omit scope and therefore mint the
 * least-privileged `booking` token. Owner integrations explicitly request
 * `business` when they are created.
 */

function secret(): string {
  return process.env.MCP_SESSION_SECRET ?? "";
}

export function isMcpConfigured(): boolean {
  return secret().length > 0;
}

export function mcpSessionUrl(input: {
  origin: string;
  session: Omit<McpSession, "expiresAt" | "scope"> & { scope?: McpScope };
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

/** Optional second lock in addition to the signed URL. */
export function bearerAccepted(header: string | null): boolean {
  const expected = process.env.MCP_BEARER_TOKEN ?? "";
  if (!expected) return true;
  const presented = (header ?? "").replace(/^Bearer\s+/i, "").trim();
  return presented.length === expected.length && presented === expected;
}
