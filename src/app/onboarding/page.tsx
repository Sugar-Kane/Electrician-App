import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CheckCircle2, LockKeyhole, Zap } from "lucide-react";

import { OnboardingForm } from "@/components/onboarding-form";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Set up your business | Volteira" };

export default async function OnboardingPage() {
  const supabase = await createClient();
  const { data: authData } = await supabase.auth.getUser();

  if (!authData.user) redirect("/login?next=/onboarding");

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id")
    .eq("user_id", authData.user.id)
    .limit(1)
    .maybeSingle();

  if (membership) redirect("/");

  // Somebody who was invited must not be offered a business to create. Building
  // a second company next door to the one holding their work is the single
  // worst outcome here: the app looks empty, and the phone number and booking
  // agent still point at the business they were supposed to join.
  const { data: invited } = await asFlexibleClient(supabase).rpc("pending_invitation_for_me");
  const invitation = Array.isArray(invited) ? (invited[0] as { token?: string } | undefined) : undefined;
  if (invitation?.token) redirect(`/invite/${invitation.token}`);

  const metadataName = authData.user.user_metadata.full_name;
  const defaultOwnerName =
    typeof metadataName === "string" ? metadataName.trim().slice(0, 120) : "";

  return (
    <main className="min-h-screen bg-canvas px-3 py-4 text-white sm:px-5 sm:py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex min-h-14 items-center justify-between gap-4">
          <div className="inline-flex items-center gap-2 text-lg font-bold tracking-[0.04em]">
            <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
            VOLTEIRA
          </div>
          <p className="hidden items-center gap-2 text-xs text-ink-muted sm:flex">
            <LockKeyhole className="h-4 w-4 text-emerald-400" aria-hidden /> Secure owner setup
          </p>
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,.72fr)_minmax(520px,1.28fr)] lg:items-start">
          <section className="lg:sticky lg:top-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">Step 1 of 3</p>
            <h1 className="mt-4 max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Set up the business you’ll run every day.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">
              This creates your private company workspace, your owner profile, and the scheduling rules for the paid diagnostic pilot.
            </p>

            <ol className="mt-7 space-y-3">
              <li className="flex items-center gap-3 rounded-control border border-brand/25 bg-brand/[0.06] p-4 text-sm font-semibold">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-brand text-on-brand">1</span>
                Business and schedule
              </li>
              <li className="flex items-center gap-3 rounded-control border border-line p-4 text-sm text-ink-muted">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-line">2</span>
                Customer booking page
              </li>
              <li className="flex items-center gap-3 rounded-control border border-line p-4 text-sm text-ink-muted">
                <span className="grid h-8 w-8 place-items-center rounded-full border border-line">3</span>
                Test diagnostic payment
              </li>
            </ol>

            <div className="mt-7 rounded-control border border-line bg-white/[0.03] p-4 text-sm leading-6 text-ink-muted">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden /> Nothing is public yet
              </p>
              <p className="mt-2">You’ll review the customer-facing booking page before sharing it.</p>
            </div>
          </section>

          <OnboardingForm
            email={authData.user.email ?? "your account"}
            defaultOwnerName={defaultOwnerName}
          />
        </div>
      </div>
    </main>
  );
}
