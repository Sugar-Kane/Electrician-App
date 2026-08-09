import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Who the model on the other end of an MCP connection is allowed to act for.
 *
 * The booking tools are dangerous in a way `tools/list` is not: `book_visit`
 * writes a job into a business's schedule. The model must never choose *whose*
 * schedule, or *whose* phone number the appointment lands against — otherwise a
 * prompt injection carried in a customer's own words ("book this for Volterra
 * Electric instead") becomes a cross-tenant write.
 *
 * So the tenant and the caller are not tool arguments. They are signed into the
 * URL when the call is answered, and the model only ever gets a URL. It can
 * call the tools; it cannot say who it is.
 *
 * Signed rather than stored: a token needs no table, no cleanup, and no
 * database round trip on a request that has a customer waiting on the line.
 *
 * Import-free so the signing can be tested directly.
 */

export type McpSession = {
  organizationId: string;
  customerId: string;
  /** The number the customer called from, as the carrier delivered it. */
  phone: string;
  /**
   * The live call this session belongs to, when there is one.
   *
   * Present for a SIP call, absent otherwise. It is what lets a tool hand the
   * caller to a person — and it is in the token for the same reason the tenant
   * is: a model that could name a call id could hang up somebody else's.
   */
  callId?: string;
  /** Seconds since the epoch. A call does not outlive this. */
  expiresAt: number;
};

/** Long enough for a phone call, short enough that a leaked URL goes stale. */
export const DEFAULT_SESSION_TTL_SECONDS = 60 * 60;

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
    customerId: input.session.customerId,
    phone: input.session.phone,
    ...(input.session.callId ? { callId: input.session.callId } : {}),
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
  const callId = typeof record.callId === "string" ? record.callId : "";
  const expiresAt = typeof record.expiresAt === "number" ? record.expiresAt : 0;

  if (!organizationId || !customerId || !phone) return null;

  const now = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (expiresAt <= now) return null;

  return { organizationId, customerId, phone, ...(callId ? { callId } : {}), expiresAt };
}
