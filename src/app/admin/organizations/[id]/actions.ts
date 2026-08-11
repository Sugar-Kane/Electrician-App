"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";

import { invitationEmail, invitationLink } from "@/lib/invitation-message";
import { sendEmail } from "@/lib/email";
import { asFlexibleClient } from "@/lib/supabase/flexible";
import { createClient } from "@/lib/supabase/server";

/**
 * Inviting somebody into a business as the platform, rather than as a member of
 * it.
 *
 * The ordinary invite path needs an owner or admin on the inside, which is
 * exactly wrong for support: the usual reason support is involved is that
 * nobody can get in at all.
 *
 * The link comes back either way. Email not arriving is one of the things
 * support exists to work around, so the console shows the URL to read out.
 */

export type AdminInviteState = { error: string; notice?: string; link?: string };

async function origin(): Promise<string> {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (configured) return configured;
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  return host ? `https://${host}` : "";
}

export async function adminInvite(
  _previousState: AdminInviteState,
  formData: FormData,
): Promise<AdminInviteState> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase().slice(0, 254);
  const role = String(formData.get("role") ?? "owner").trim();

  if (!organizationId) return { error: "No business was named." };
  if (!/^[^@\s]+@[^@.\s]+\.[^@\s]{2,}$/.test(email)) {
    return { error: "That email address does not look right." };
  }

  const supabase = asFlexibleClient(await createClient());

  // The database refuses a caller who is not a platform admin, so there is no
  // permission check to duplicate here.
  const { data: token, error } = await supabase.rpc("admin_invite_to_organization", {
    p_organization_id: organizationId,
    p_email: email,
    p_role: role,
  });

  if (error || typeof token !== "string") {
    return { error: "That invitation could not be created." };
  }

  const { data: organization } = await supabase
    .from("organizations")
    .select("name")
    .eq("id", organizationId)
    .maybeSingle();

  const { data: authData } = await supabase.auth.getUser();
  const link = invitationLink(await origin(), token);
  const organizationName =
    typeof organization?.name === "string" ? organization.name : "your team";

  const mail = invitationEmail({
    organizationName,
    email,
    inviterName: authData.user?.email ?? "Volteira",
    role,
    link,
    expiresInDays: 14,
  });

  const sent = await sendEmail({ to: email, subject: mail.subject, text: mail.text, html: mail.html });

  revalidatePath(`/admin/organizations/${organizationId}`);

  return {
    error: "",
    notice: sent.ok
      ? `Invitation emailed to ${email}.`
      : `Invitation created, but the email failed (${sent.errorCode}). Send them this link.`,
    link,
  };
}
