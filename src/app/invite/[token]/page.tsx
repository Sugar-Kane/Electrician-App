import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { LockKeyhole, TriangleAlert, Zap } from "lucide-react";

import { AcceptInvitationForm } from "@/components/accept-invitation-form";
import { acceptOutcome, roleLabel } from "@/lib/invitation-message";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Join a business | Volteira",
  // An invitation link is a credential. It should not be in an index.
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
      <div className="w-full max-w-md">
        <div className="mb-6 inline-flex items-center gap-2 text-lg font-bold tracking-[0.04em]">
          <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
          VOLTEIRA
        </div>
        <section className="rounded-panel border border-line bg-surface p-6">{children}</section>
      </div>
    </main>
  );
}

function Refusal({ heading, detail }: { heading: string; detail: string }) {
  return (
    <Shell>
      <div className="flex items-start gap-3">
        <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-caution" aria-hidden />
        <div>
          <h1 className="text-lg font-semibold">{heading}</h1>
          <p className="mt-2 text-sm leading-6 text-ink-muted">{detail}</p>
        </div>
      </div>
      <Link
        href="/"
        className="tap-target mt-6 flex min-h-12 items-center justify-center rounded-control border border-line text-sm font-semibold"
      >
        Go to Volteira
      </Link>
    </Shell>
  );
}

/**
 * Accepting an invitation.
 *
 * The page never decides anything: it reads what the token points at, and the
 * database function does the deciding when the form is submitted. That is
 * deliberate — the check that matters is "is this the address it was sent to",
 * and that has to be made where the session is, not where the markup is.
 */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Refuse anything that is not shaped like a token before touching the
  // database, so a scan of /invite/<anything> costs nothing.
  if (!UUID.test(token)) {
    const outcome = acceptOutcome("invalid");
    return <Refusal heading={outcome.heading} detail={outcome.detail} />;
  }

  const supabase = asFlexibleClient(await createClient());
  const { data } = await supabase.rpc("organization_invitation_preview", { p_token: token });
  const invitation = Array.isArray(data) ? (data[0] as Record<string, unknown> | undefined) : undefined;

  if (!invitation) {
    const outcome = acceptOutcome("invalid");
    return <Refusal heading={outcome.heading} detail={outcome.detail} />;
  }

  const status = text(invitation.status);
  if (status !== "pending") {
    const outcome = acceptOutcome(status);
    return <Refusal heading={outcome.heading} detail={outcome.detail} />;
  }

  const organizationName = text(invitation.organization_name);
  const invitedEmail = text(invitation.email);
  const role = text(invitation.role);

  const { data: authData } = await supabase.auth.getUser();
  const user = authData.user;

  // Not signed in: send them to make an account, and bring them straight back.
  // The address is prefilled because the invitation only works for that one.
  if (!user) {
    const next = encodeURIComponent(`/invite/${token}`);
    const email = encodeURIComponent(invitedEmail);
    return (
      <Shell>
        <h1 className="text-xl font-semibold">Join {organizationName}</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          You have been invited as {roleLabel(role)}. Create your account with{" "}
          <strong className="text-ink">{invitedEmail}</strong> — the invitation only
          works for that address.
        </p>
        <Link
          href={`/signup?next=${next}&email=${email}`}
          className="tap-target mt-6 flex min-h-14 items-center justify-center rounded-control bg-brand text-sm font-bold text-on-brand"
        >
          Create my account
        </Link>
        <Link
          href={`/login?next=${next}`}
          className="tap-target mt-3 flex min-h-12 items-center justify-center rounded-control border border-line text-sm font-semibold"
        >
          I already have one
        </Link>
        <p className="mt-6 flex items-center gap-2 text-xs text-ink-faint">
          <LockKeyhole className="h-4 w-4 text-positive" aria-hidden />
          You will only see this business, and only what your role allows.
        </p>
      </Shell>
    );
  }

  // Signed in as somebody else. Say so before they submit and get refused.
  if ((user.email ?? "").toLowerCase() !== invitedEmail) {
    return (
      <Shell>
        <h1 className="text-lg font-semibold">This invitation is for a different address</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          It was sent to <strong className="text-ink">{invitedEmail}</strong>, and you
          are signed in as <strong className="text-ink">{user.email}</strong>. Sign out
          and sign back in with the invited address.
        </p>
        <Link
          href={`/login?next=${encodeURIComponent(`/invite/${token}`)}`}
          className="tap-target mt-6 flex min-h-14 items-center justify-center rounded-control bg-brand text-sm font-bold text-on-brand"
        >
          Switch accounts
        </Link>
      </Shell>
    );
  }

  // Already a member of this business: nothing to accept.
  const { data: existing } = await supabase
    .from("organization_members")
    .select("id")
    .eq("user_id", user.id)
    .limit(1)
    .maybeSingle();
  if (existing) redirect("/");

  return (
    <Shell>
      <h1 className="text-xl font-semibold">Join {organizationName}</h1>
      <p className="mt-2 text-sm leading-6 text-ink-muted">
        You have been invited as {roleLabel(role)}, signed in as{" "}
        <strong className="text-ink">{user.email}</strong>.
      </p>
      <AcceptInvitationForm token={token} />
    </Shell>
  );
}
