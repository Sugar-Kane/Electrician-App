/**
 * Which business a request acts for, among the caller's memberships.
 *
 * - Impersonating (a platform admin who opened a business): that business, and
 *   only if the database gave them a membership in it for the session.
 * - Otherwise the business the person chose, if they still belong to it.
 * - Otherwise their first (oldest) membership.
 *
 * Never a business the caller has no membership in, whatever the cookie or
 * session claims: the choice only ever picks among their own rows.
 *
 * Import-free, so the rule is tested on its own.
 */
export function chooseMembership<T extends { organization_id?: unknown }>(
  memberships: readonly T[],
  input: { impersonatingOrganizationId?: string | null; chosenOrganizationId?: string | null },
): T | null {
  const id = (row: T) => (typeof row.organization_id === "string" ? row.organization_id.toLowerCase() : "");
  const impersonating = (input.impersonatingOrganizationId ?? "").toLowerCase();
  if (impersonating) return memberships.find((row) => id(row) === impersonating) ?? null;
  const chosen = (input.chosenOrganizationId ?? "").toLowerCase();
  return (chosen ? memberships.find((row) => id(row) === chosen) : undefined) ?? memberships[0] ?? null;
}
