import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { TeamManager, type Invitation, type Member } from "@/components/team-manager";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Team | Volteira" };

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

/**
 * Who is in this business, and who has been asked to join.
 *
 * The roster comes from an RPC rather than a select: memberships hold user ids
 * and the names live in auth.users, which the client cannot read. The function
 * refuses anyone who is not already managing this organization.
 */
export default async function TeamSettingsPage() {
  const supabase = asFlexibleClient(await createClient());

  const { data: membership } = await supabase
    .from("organization_members")
    .select("organization_id, role")
    .limit(1)
    .maybeSingle();

  const organizationId = text(membership?.organization_id);
  const canManage = ["owner", "admin"].includes(text(membership?.role));

  const { data: roster } = organizationId
    ? await supabase.rpc("organization_roster", { p_organization_id: organizationId })
    : { data: null };

  const { data: invitations } = organizationId
    ? await supabase
        .from("organization_invitations")
        .select("id, email, role, created_at, expires_at")
        .eq("organization_id", organizationId)
        .is("accepted_at", null)
        .is("revoked_at", null)
        .order("created_at", { ascending: false })
    : { data: null };

  const members: Member[] = Array.isArray(roster)
    ? roster.map((row: Record<string, unknown>) => ({
        userId: text(row.user_id),
        email: text(row.email),
        fullName: text(row.full_name),
        role: text(row.role),
        isMe: row.is_me === true,
      }))
    : [];

  const pending: Invitation[] = Array.isArray(invitations)
    ? invitations.map((row: Record<string, unknown>) => ({
        id: text(row.id),
        email: text(row.email),
        role: text(row.role),
        expiresAt: text(row.expires_at),
      }))
    : [];

  return (
    <FieldPageShell
      backHref="/settings"
      title="Team"
      eyebrow="Your business"
      description="Who can open this business, and who has been invited to."
    >
      {organizationId ? (
        <TeamManager
          organizationId={organizationId}
          members={members}
          invitations={pending}
          canManage={canManage}
        />
      ) : (
        <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 className="text-lg font-semibold">No business workspace yet</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            Finish setting up your business and this is where you invite the people who
            work in it.
          </p>
        </section>
      )}
    </FieldPageShell>
  );
}
