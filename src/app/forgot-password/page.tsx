import type { Metadata } from "next";

import { AuthShell } from "@/components/auth-shell";
import { ForgotPasswordForm } from "@/components/forgot-password-form";

export const metadata: Metadata = { title: "Reset your password | Volteira" };

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <AuthShell
      eyebrow="Forgot your password?"
      title="Reset your password"
      description="Enter the email you sign in with. We'll send a link that lets you choose a new password."
    >
      <ForgotPasswordForm initialError={error} />
    </AuthShell>
  );
}
