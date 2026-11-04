/**
 * How much of Volteira's built-in AI a business may use each month.
 *
 * Volteira pays for the built-in AI, so each business gets an allowance of
 * it. Past that, the feature says so and points to ChatGPT or Claude, which
 * run on the business's own plan and cost Volteira nothing. Kept free of the
 * database so the rule can be tested on its own.
 */

/** Uses a business gets each calendar month, unless AI_MONTHLY_LIMIT says otherwise. */
export const DEFAULT_MONTHLY_AI_USES = 200;

/** The limit set for this deployment: a whole number of uses, 0 for none, or the default. */
export function monthlyAiLimit(configured: string | undefined): number {
  const raw = (configured ?? "").trim();
  if (!raw) return DEFAULT_MONTHLY_AI_USES;
  const value = Number(raw);
  return Number.isInteger(value) && value >= 0 ? value : DEFAULT_MONTHLY_AI_USES;
}

/** The first instant of the calendar month `now` is in, in UTC. */
export function monthStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

export const AI_LIMIT_MESSAGE =
  "You've used this month's built-in AI. It resets on the 1st. Until then, do this in ChatGPT or Claude: Settings → Use in ChatGPT.";

/** Whether one more use fits, given how many this month has had. */
export function aiUseAllowed(usedThisMonth: number, limit: number): boolean {
  if (!Number.isFinite(usedThisMonth) || usedThisMonth < 0) return limit > 0;
  return usedThisMonth < limit;
}
