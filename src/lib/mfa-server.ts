import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { mfaBlocks, mfaRequiredFor, mfaStep, type MfaStep } from "@/lib/mfa-policy";
import { createClient } from "@/lib/supabase/server";

/**
 * Where the signed-in person stands with two-step sign-in (mfa-policy.ts).
 * Read from their own session: the assurance level is in their token, and the
 * factors are their own.
 */
export const currentMfaStep = cache(async (): Promise<MfaStep> => {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return "none";
  const [{ data: level }, { data: factors }, { currentContext }, { isPlatformAdmin }] = await Promise.all([
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    supabase.auth.mfa.listFactors(),
    import("@/lib/request-context"),
    import("@/lib/admin-console"),
  ]);
  const [context, platformAdmin] = await Promise.all([currentContext(), isPlatformAdmin()]);
  return mfaStep({
    required: mfaRequiredFor({ role: context?.role ?? "", platformAdmin }),
    aal: level?.currentLevel ?? null,
    hasFactor: (factors?.totp ?? []).length > 0,
    now: new Date(),
  });
});

/** For a page: send someone who has to finish two-step sign-in to where they can. */
export async function requireMfa(nextPath: string): Promise<void> {
  const step = await currentMfaStep();
  if (step === "verify") redirect(`/mfa?next=${encodeURIComponent(nextPath)}`);
  if (step === "enroll_now") redirect(`/settings/security?required=1&next=${encodeURIComponent(nextPath)}`);
}

/** For an action: why it can't run until two-step sign-in is finished, or "". */
export async function mfaRefusal(): Promise<string> {
  const step = await currentMfaStep();
  if (!mfaBlocks(step)) return "";
  return step === "verify"
    ? "Enter the code from your authenticator app first (Settings → Two-step sign-in)."
    : "Set up two-step sign-in first: Settings → Two-step sign-in. It's required for owners and admins.";
}
