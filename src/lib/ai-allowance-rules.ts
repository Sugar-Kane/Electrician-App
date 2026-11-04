/**
 * How much of Volteira's built-in AI a business may use each month.
 *
 * Volteira pays for the built-in AI, so each business gets an allowance of
 * it. Past that, the feature says so and points to ChatGPT or Claude, which
 * run on the business's own plan and cost Volteira nothing, or to Premium,
 * which includes unlimited built-in AI. Kept free of the database so the rule
 * can be tested on its own.
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
  "You've used this month's built-in AI. It resets on the 1st. For unlimited built-in AI, upgrade to Premium in Your account. Or do this in ChatGPT or Claude for free: Settings → Use in ChatGPT.";

/** Subscription states that come with unlimited built-in AI. */
const PAID_STATUSES = new Set(["active", "trialing"]);

export function paidPlanActive(status: string | null | undefined): boolean {
  return PAID_STATUSES.has(status ?? "");
}

export type AiLimit = number | "unlimited";

/**
 * The allowance that applies to one business, most specific first:
 *
 * 1. unlimited, when the platform said so for this business;
 * 2. unlimited, while it is on the paid plan;
 * 3. its own number, when the platform gave it one;
 * 4. the platform's default from the admin console;
 * 5. the deployment's AI_MONTHLY_LIMIT, or 200.
 */
export function resolveAiLimit(input: {
  unlimited?: boolean | null;
  subscriptionStatus?: string | null;
  businessLimit?: number | null;
  platformDefault?: number | null;
  configured?: string;
}): AiLimit {
  if (input.unlimited === true) return "unlimited";
  if (paidPlanActive(input.subscriptionStatus)) return "unlimited";
  const own = input.businessLimit;
  if (typeof own === "number" && Number.isInteger(own) && own >= 0) return own;
  const platform = input.platformDefault;
  if (typeof platform === "number" && Number.isInteger(platform) && platform >= 0) return platform;
  return monthlyAiLimit(input.configured);
}

/** Whether one more use fits, given how many this month has had. */
export function aiUseAllowed(usedThisMonth: number, limit: AiLimit): boolean {
  if (limit === "unlimited") return true;
  if (!Number.isFinite(usedThisMonth) || usedThisMonth < 0) return limit > 0;
  return usedThisMonth < limit;
}
