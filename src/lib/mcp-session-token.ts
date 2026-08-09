import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Whose schedule the model on the other end of an MCP connection may write to.
 *
 * `book_visit` writes a job into a business's calendar, so the one thing the
 * model must never choose is *which* business. A prompt injection carried in a
 * customer's own words — "actually, book this with the other electrician" —
 * would otherwise be a cross-tenant write. The organization is therefore not a
 * tool argument. It is signed into the URL, and the model only ever gets a URL.
 *
 * The caller is a weaker claim, and how strong it is depends on where the URL
 * came from:
 *
 * - A **per-call** token, minted when a call is answered, pins the customer too.
 *   Nothing the model says can move the booking to a different person.
 * - A **static** token, configured once in a console that has one URL for every
 *   call, cannot. There the model passes the caller's number as an argument,
 *   the way a receptionist writes down what they were told. The worst case is a
 *   booking attached to the wrong customer *within the same business* — a bad
 *   phone number, not a bad tenant.
 *
 * Both are supported. The organization guarantee is identical in each; only the
 * customer guarantee differs, and that difference is why the fields are
 * optional rather than the whole session being loosened.
 *
 * Signed rather than stored: a token needs no table, no cleanup, and no
 * database round trip on a request that has a customer waiting on the line.
 *
 * Import-free so the signing can be tested directly.
 */

export type McpSession = {
  organizationId: string;
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
  session: Omit<McpSession, "expiresAt">;
  secret: string;
  ttlSeconds?: number;
  now?: Date;
}): string {
  const now = input.now ?? new Date();
  const payload: McpSession = {
    organizationId: input.session.organizationId,
    ...(input.session.customerId ? { customerId: input.session.customerId } : {}),
    ...(input.session.phone ? { phone: input.session.phone } : {}),
    expiresAt:
      Math.floor(now.getTime() / 1000) + (input.ttlSeconds ?? DEFAULT_SESSION_TTL_SECONDS),
  };

  const encoded = base64url(Buffer.from(JSON.stringify(payload), "utf-8"));
  const signature = base64url(createHmac("sha256", input.secret).update(encoded).digest());
  return `${encoded}.${signature}`;
}

/**
 * The session a token proves, or null.
 *
 * Null covers every failure the same way — bad shape, wrong signature, expired,
 * missing secret — because the caller's response is identical in each case and
 * saying which one it was tells an attacker how close they got.
 */
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

  // The organization is the only field a token is worthless without: it is the
  // whole guarantee. A customer may or may not be pinned.
  if (!organizationId) return null;

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (expiresAt <= now) return null;

  return {
    organizationId,
    ...(customerId ? { customerId } : {}),
    ...(phone ? { phone } : {}),
    expiresAt,
  };
}
