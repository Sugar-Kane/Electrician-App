import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";
import { AuthShell } from "@/components/auth-shell";
import { getSafeNextPath } from "@/lib/auth-redirect";

export const metadata: Metadata = { title: "Sign in | Volteira" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <AuthShell eyebrow="Welcome back" title="Sign in to Volteira" description="Open today’s schedule, jobs, materials, and payments.">
      <AuthForm mode="login" nextPath={getSafeNextPath(next)} initialError={error} />
    </AuthShell>
  );
}
