import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getSafeNextPath } from "@/lib/auth-redirect";

export const metadata: Metadata = { title: "Create account | Volteira" };

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; email?: string }>;
}) {
  const { next, email } = await searchParams;
  const nextPath = getSafeNextPath(next ?? "/onboarding");
  // Prefilled when they arrived from an invitation, which only works for the
  // address it was sent to. Trimmed to something address-shaped so the field
  // cannot be stuffed with arbitrary text from a link.
  const invited = typeof email === "string" && /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email) ? email : undefined;
  return (
    <AuthShell eyebrow="Set up your business" title="Create your account" description="Start with your email and a password. Next you'll add your business details, and you can invite your team after that.">
      <AuthForm mode="signup" nextPath={nextPath} defaultEmail={invited} />
    </AuthShell>
  );
}
