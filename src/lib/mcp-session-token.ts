import { createHmac, timingSafeEqual } from "node:crypto";

/** What a signed MCP URL is allowed to do. */
export type McpScope = "booking" | "business";

/**
 * Whose data the model on the other end of an MCP connection may act for.
 *
 * The organization is signed into the URL so a model can never choose another
 * tenant in a tool argument. Scope is signed for the same reason: a URL handed
 * to the public-facing receptionist must never become a back door to invoices,
 * customer messages or business settings.
 *
 * Old tokens did not carry a scope. They continue to verify as `booking`, which
 * is intentionally the least-privileged mode and preserves every existing
 * voice/receptionist integration without granting it new powers.
 */
export type McpSession = {
  organizationId: string;
  scope: McpScope;
  /** Pinned by a per-call token; absent from a static one. */
  customerId?: string;
  /** The number the customer called from, when the token was minted for a call. */
  phone?: string;
  /** Seconds since the epoch. A leaked URL stops working here. */
  expiresAt: number;
};

/** Long enough for a phone call, short enough that a leaked URL goes stale. */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;

/** A console-configured URL outlives any one call, so it is dated in months. */
export const STATIC_SESSION_TTL_SECONDS = 60 * 60 * 24 * 180;

function base64url(value: Buffer): string {
  return value.toString("base64url");
}

export function signMcpSessionToken(input: {
  session: Omit<McpSession, "expiresAt" | "scope"> & { scope?: McpScope };
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const payload: McpSession = {
    organizationId: input.session.organizationId,
    scope: input.session.scope ?? "booking",
    ...(input.session.customerId ? { customerId: input.session.customerId } : {}),
    ...(input.session.phone ? { phone: input.session.phone } : {}),
    expiresAt:
      Math.floor(now.getTime() / 1000) + (input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS),
  };

  const encoded = base64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const signature = base64url(createHmac("sha256", input.secret).update(encoded).digest());
  return `${encoded}.${signature}`;
}

/** The session a token proves, or null. */
export function readMcpSessionToken(input: {
  token: string;
  secret: string;
  now?: Date;
}): McpSession | null {
  if (!input.secret || !input.token) return null;

  const parts = input.token.split(".");
  if (parts.length !== 2) return null;
  const [encoded, signature] = parts as [string, string];

  const expected = Buffer.from(
    base64url(createHmac("sha256", input.secret).update(encoded).digest()),
  );
  const provided = Buffer.from(signature);
  if (expected.length !== provided.length) return null;
  if (!timingSafeEqual(expected, provided)) return null;

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf-8"));
  } catch {
    return null;
  }

  if (typeof payload !== "object" || payload === null) return null;
  const record = payload as Record<string, unknown>;

  const organizationId = typeof record.organizationId === "string" ? record.organizationId : "";
  const customerId = typeof record.customerId === "string" ? record.customerId : "";
  const phone = typeof record.phone === "string" ? record.phone : "";
  const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : 0;
  // Backwards compatibility is deliberately least privilege.
  const scope: McpScope = record.scope === "business" ? "business" : "booking";

  if (!organizationId) return null;

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (expiresAt <= now) return null;

  return {
    organizationId,
    scope,
    ...(customerId ? { customerId } : {}),
    ...(phone ? { phone } : {}),
    expiresAt,
  };
}
