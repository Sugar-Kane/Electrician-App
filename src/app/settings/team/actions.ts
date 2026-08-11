"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { invitationEmail, invitationLink } from "@/lib/invitation-message";
import { sendEmail } from "@/lib/email";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Inviting somebody into a business, and taking the invitation back.
 *
 * Both go through the caller's session, so RLS is what decides whether they may
 * manage this organization's members — the organization id in the form is a
 * convenience, never an authorisation.
 */

export type TeamActionState = { error: string; notice?: string };

const ROLES = new Set(["owner", "admin", "dispatcher", "technician", "accountant"]);

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

async function origin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;

  // Falling back to the request's own host keeps invitation links working on a
  // preview deployment, where the configured origin is the production one.
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  return host ? `https://${host}` : "";
}

export async function inviteTeammate(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const email = String(formData.get("email") ?? "")
    .trim()
    .toLowerCase()
    .slice(0, 254);
  const role = String(formData.get("role") ?? "technician").trim();

  if (!organizationId) return { error: "No business workspace was found." };
  if (!/^[^@\s]+@[^@.\s]+\.[^@\s]{2,}$/.test(email)) {
    return { error: "That email address does not look right." };
  }
  if (!ROLES.has(role)) return { error: "Pick a role for this person." };

  const supabase = asFlexibleClient(await createClient());

  const { data: authData } = await supabase.auth.getUser();
  const inviterName =
    text(authData.user?.user_metadata?.full_name).trim() || text(authData.user?.email);

  // Re-inviting somebody replaces the pending invite rather than leaving two
  // live tokens: the partial unique index would refuse the second one anyway,
  // and the person's most recent email should be the one that works.
  await supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("organization_id", organizationId)
    .eq("email", email)
    .is("accepted_at", null)
    .is("revoked_at", null);

  const { data: invitation, error } = await supabase
    .from("organization_invitations")
    .insert({
      organization_id: organizationId,
      email,
      role,
      invited_by: authData.user?.id ?? null,
    })
    .select("token, expires_at")
    .maybeSingle();

  if (error || !invitation) {
    // RLS answers a non-manager with a policy violation rather than silence.
    return { error: "You do not have permission to invite people to this business." };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const link = invitationLink(await origin(), text(invitation.token));
  const mail = invitationEmail({
    organizationName: text(organization?.name) || "your team",
    email,
    inviterName,
    role,
    link,
    expiresInDays: 14,
  });

  const sent = await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });

  revalidatePath("/settings/team");

  // The invitation exists either way — a mail provider being down should not
  // cost somebody the invite, and the link can be handed over by any means.
  if (!sent.ok) {
    return {
      error: "",
      notice: `Invitation created, but the email could not be sent (${sent.errorCode}). Send them this link: ${link}`,
    };
  }

  return { error: "", notice: `Invitation sent to ${email}.` };
}

export async function revokeInvitation(
  _previousState: TeamActionState,
  formData: FormData,
): Promise<TeamActionState> {
  const invitationId = String(formData.get("invitationId") ?? "").trim();
  if (!invitationId) return { error: "That invitation was not found." };

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase
    .from("organization_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitationId)
    .is("accepted_at", null)
    .select("id");

  if (error || !Array.isArray(data) || data.length === 0) {
    return { error: "That invitation could not be cancelled." };
  }

  revalidatePath("/settings/team");
  return { error: "", notice: "Invitation cancelled. The link no longer works." };
}
