/**
 * Whether a ChatGPT/Claude business connection may act, decided in one place.
 *
 * A business connection is a signed URL naming a business and a credential. A
 * valid signature only proves Volteira issued it; on every request it must
 * also still be a live credential of that same business (not revoked, not
 * expired), and the owner who created it must still be an owner there. Any
 * other answer stops the request before a single tool runs.
 *
 * The lookups are passed in, so the rule is tested without a database; the
 * route gives it the service-role queries, scoped by both ids.
 */

import { connectionHolderAllowed } from "./mcp-session-token.ts";

export type BusinessConnectionLookups = {
  /** The credential, only if it belongs to this business. Null when there is no such row. */
  credential(credentialId: string, organizationId: string): Promise<{
    createdBy: string;
    revokedAt: string | null;
    expiresAt: string | null;
  } | null>;
  /** The person's role in this business, or null when they are not a member. */
  memberRole(organizationId: string, userId: string): Promise<string | null>;
};

export type BusinessConnectionVerdict =
  | { ok: true; connectedBy: string }
  | { ok: false; status: 401; message: string };

const RECONNECT = "Reconnect ChatGPT from Volteira: Settings → Use in ChatGPT or Claude";

export async function authorizeBusinessMcpConnection(
  session: { scope: string; organizationId: string; credentialId?: string | null },
  lookups: BusinessConnectionLookups,
  now: Date = new Date(),
): Promise<BusinessConnectionVerdict> {
  if (session.scope !== "business") return { ok: false, status: 401, message: "This link is not a business connection." };
  const organizationId = (session.organizationId ?? "").trim();
  const credentialId = (session.credentialId ?? "").trim();
  if (!organizationId || !credentialId) return { ok: false, status: 401, message: RECONNECT };

  const credential = await lookups.credential(credentialId, organizationId);
  if (!credential) return { ok: false, status: 401, message: "This ChatGPT connection has been revoked or expired" };
  if (credential.revokedAt) return { ok: false, status: 401, message: "This ChatGPT connection has been revoked or expired" };
  const expires = credential.expiresAt ? Date.parse(credential.expiresAt) : NaN;
  if (!Number.isFinite(expires) || expires <= now.getTime()) {
    return { ok: false, status: 401, message: "This ChatGPT connection has been revoked or expired" };
  }

  // The connection acts for the whole business, so it lasts only while the
  // person who made it is still an owner there. Removed or demoted, their
  // link stops working at once rather than at its expiry.
  const connectedBy = (credential.createdBy ?? "").trim();
  const role = connectedBy ? await lookups.memberRole(organizationId, connectedBy) : null;
  if (!connectionHolderAllowed(role)) {
    return {
      ok: false,
      status: 401,
      message: `The owner who connected ChatGPT is no longer an owner here. ${RECONNECT}`,
    };
  }
  return { ok: true, connectedBy };
}
