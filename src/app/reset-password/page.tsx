import type { Metadata } from "next";
import Link from "next/link";

import { AuthShell } from "@/components/auth-shell";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { mayResetPasswordNow } from "@/lib/password-reset";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Choose a new password | Volteira" };

export default async function ResetPasswordPage() {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const allowed = Boolean(claims) && mayResetPasswordNow(claims?.amr);

  if (!allowed) {
    return (
      <AuthShell
        eyebrow="Reset your password"
        title="This link has run out"
        description="Reset links work once, for an hour, in the browser that asked for them."
      >
        <Link
          href="/forgot-password"
          className="tap-target flex min-h-14 w-full items-center justify-center rounded-control bg-brand px-5 text-sm font-semibold text-on-brand"
        >
          Send a new reset link
        </Link>
        <p className="mt-6 text-center text-sm text-ink-muted">
          Know your password?{" "}
          <Link href="/login" className="tap-target inline-flex items-center font-semibold text-brand">
            Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  const email = typeof claims?.email === "string" ? claims.email : "";

  return (
    <AuthShell
      eyebrow="Reset your password"
      title="Choose a new password"
      description={email ? `For ${email}. You'll stay signed in on this device.` : "You'll stay signed in on this device."}
    >
      <ResetPasswordForm email={email} />
    </AuthShell>
  );
}
