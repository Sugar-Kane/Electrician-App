/**
 * Operational tool activity can reveal information about customer work, so
 * only business decision makers can open the AI operations overview.
 * Other organization roles continue to use their existing job screens.
 */
export function canViewAiOperations(role: string): boolean {
  return role === "owner" || role === "admin";
}
