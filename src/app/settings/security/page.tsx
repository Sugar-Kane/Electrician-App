import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FieldPageShell } from "@/components/field-page-shell";
import { MfaSetup } from "@/components/mfa-setup";
import { getSafeNextPath } from "@/lib/auth-redirect";
import { currentMfaStep } from "@/lib/mfa-server";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Two-step sign-in | Volteira" };

/** Two-step sign-in (SEC-001-002): offered to everyone, required for owners and admins from the deadline. */
export default async function SecuritySettingsPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  if (!data.user) redirect("/login?next=/settings/security");
  const step = await currentMfaStep();
  // Set up but not entered this session: the code first, then back here.
  if (step === "verify") redirect(`/mfa?next=${encodeURIComponent("/settings/security")}`);

  return (
    <FieldPageShell
      title="Two-step sign-in"
      eyebrow="Settings"
      backHref="/settings"
      description="A code from an app on your phone, as well as your password, so a stolen password alone can't open your business."
    >
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <MfaSetup nextPath={next ? getSafeNextPath(next) : null} />
      </section>
    </FieldPageShell>
  );
}
