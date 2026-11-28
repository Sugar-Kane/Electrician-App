/**
 * Two-step sign-in (compliance SEC-001-002). Owners, admins and Volteira's
 * own platform staff sign in with a password and a code from an authenticator
 * app. It is offered now and required from MFA_REQUIRED_FROM (Adam's
 * decision, 2026-11-26: offer now, require in 14 days).
 *
 * Anyone who has set it up is always asked for the code, before or after the
 * date. Technicians are not required to, and may still choose to.
 *
 * Import-free, so the rule is tested directly.
 */

/** Midnight at the start of Dec 10, 2026, Pacific time. */
export const MFA_REQUIRED_FROM = "2026-12-10T08:00:00Z";

export type MfaStep =
  /** Nothing to do. */
  | "none"
  /** Set up, but this session has not entered its code yet. */
  | "verify"
  /** Not set up, and the deadline has not arrived: a reminder. */
  | "enroll_soon"
  /** Not set up, past the deadline: nothing sensitive until it is. */
  | "enroll_now";

/** Whether this person must use two-step sign-in. */
export function mfaRequiredFor(input: { role: string; platformAdmin: boolean }): boolean {
  return input.platformAdmin || input.role === "owner" || input.role === "admin";
}

export function mfaStep(input: {
  required: boolean;
  /** The session's assurance level: "aal1" after a password, "aal2" after the code. */
  aal: string | null;
  /** A verified authenticator factor exists. */
  hasFactor: boolean;
  now: Date;
}): MfaStep {
  if (input.hasFactor) return input.aal === "aal2" ? "none" : "verify";
  if (!input.required) return "none";
  return input.now.getTime() >= Date.parse(MFA_REQUIRED_FROM) ? "enroll_now" : "enroll_soon";
}

/** Whether a step stops owner/admin actions and the admin area. */
export function mfaBlocks(step: MfaStep): boolean {
  return step === "verify" || step === "enroll_now";
}

/** A six-digit code from an authenticator app, spaces allowed. */
export function readTotpCode(value: unknown): string | null {
  const digits = String(value ?? "").replace(/\s+/g, "");
  return /^\d{6}$/.test(digits) ? digits : null;
}

