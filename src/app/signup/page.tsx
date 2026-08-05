import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getSafeNextPath } from "@/lib/auth-redirect";

export const metadata: Metadata = { title: "Create account | Volteira" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const nextPath = getSafeNextPath(next ?? "/onboarding");
  return (
    <AuthShell eyebrow="Start your workspace" title="Create your account" description="Set up secure access for your electrical business. You can invite the team after signing in.">
      <AuthForm mode="signup" nextPath={nextPath} />
    </AuthShell>
  );
}
