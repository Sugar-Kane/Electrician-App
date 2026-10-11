/**
 * Who may set a new password without typing the old one.
 *
 * Account → Security asks for the current password, so a phone left unlocked
 * cannot be used to lock its owner out of their own account. The one
 * exception is somebody who has just come back through a reset link: they
 * have shown they hold the inbox, and the reason they are here at all is that
 * they do not know the password.
 *
 * Supabase writes how a session was signed in into the token's `amr` claim,
 * and a reset link signs in with the method "recovery". That session may set
 * a password for an hour after the link was opened, the same hour the link
 * itself lasts. No other session may set one this way.
 *
 * Import-free, so the rule can be tested without a request.
 */

export const RECOVERY_WINDOW_SECONDS = 60 * 60;

/** The same floor as Account → Security. */
export const MIN_NEW_PASSWORD_LENGTH = 10;

/** A minute either way, for clocks that do not quite agree. */
const CLOCK_SKEW_SECONDS = 60;

export function mayResetPassword(amr: unknown, nowSeconds: number): boolean {
  if (!Array.isArray(amr)) return false;

  return amr.some((entry: unknown) => {
    if (!entry || typeof entry !== "object") return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    if (method !== "recovery") return false;

    const at = typeof timestamp === "number" ? timestamp : Number.NaN;
    if (!Number.isFinite(at)) return false;
    if (at > nowSeconds + CLOCK_SKEW_SECONDS) return false;
    return nowSeconds - at <= RECOVERY_WINDOW_SECONDS;
  });
}

/** Why a new password is refused before it is sent, or "" when it is fine. */
export function newPasswordProblem(password: string, confirmation: string): string {
  if (password.length < MIN_NEW_PASSWORD_LENGTH) {
    return `Use at least ${MIN_NEW_PASSWORD_LENGTH} characters for the new password.`;
  }
  if (password !== confirmation) return "The two passwords do not match.";
  return "";
}

/** The same rule, against the clock now. */
export function mayResetPasswordNow(amr: unknown): boolean {
  return mayResetPassword(amr, Math.floor(Date.now() / 1000));
}
