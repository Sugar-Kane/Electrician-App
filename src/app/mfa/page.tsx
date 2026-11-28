import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { AuthShell } from "@/components/auth-shell";
import { MfaVerifyForm } from "@/components/mfa-verify-form";
import { getSafeNextPath } from "@/lib/auth-redirect";
import { currentMfaStep } from "@/lib/mfa-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-step sign-in | Volteira" };

/** The code step after the password, for anyone who has set up two-step sign-in (SEC-001-002). */
export default async function MfaPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = getSafeNextPath(next);
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect(`/login?next=${encodeURIComponent(nextPath)}`);
  if ((await currentMfaStep()) !== "verify") redirect(nextPath);
  return (
    <AuthShell eyebrow="Two-step sign-in" title="Enter your code" description="Open your authenticator app and type the 6-digit code for Volteira.">
      <MfaVerifyForm nextPath={nextPath} />
    </AuthShell>
  );
}
