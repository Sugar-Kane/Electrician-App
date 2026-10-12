"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { listRecentBookings } from "@/lib/admin-console";
import { invitationEmail, invitationLink } from "@/lib/invitation-message";
import { fetchEmailStatus, sendEmail } from "@/lib/email";
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

const ROLES = new Set(["owner", "admin", "dispatcher", "technician", "accountant"]);

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
  // No default: who gets an owner's powers is a decision, not a fallback.
  const role = String(formData.get("role") ?? "").trim();

  if (!organizationId) return { error: "No business was named." };
  if (!ROLES.has(role)) return { error: "Choose what they can do in this business." };
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

/**
 * Showing a business's private details on one page, for a stated reason.
 *
 * The database records the reason and hands back the record's id; the page
 * comes back with that id on its address, and shows the details only while it
 * is this admin's own and less than fifteen minutes old.
 */
export async function revealPrivateDetails(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "").trim();
  const scope = String(formData.get("scope") ?? "").trim().slice(0, 80);
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200);
  const returnTo = String(formData.get("returnTo") ?? "");
  if (!/^[0-9a-f-]{36}$/i.test(organizationId)) return;

  // Only ever back into this business's own console pages.
  const base = `/admin/organizations/${organizationId}`;
  const back = returnTo === base || returnTo.startsWith(`${base}?`) || returnTo.startsWith(`${base}/`) ? returnTo : base;
  const join = back.includes("?") ? "&" : "?";
  if (reason.length < 3) redirect(`${back}${join}reveal=reason`);

  const supabase = asFlexibleClient(await createClient());
  const { data, error } = await supabase.rpc("admin_record_reveal", {
    p_organization_id: organizationId,
    p_scope: scope,
    p_reason: reason,
  });
  if (error || typeof data !== "string") redirect(`${back}${join}reveal=refused`);

  redirect(`${back}${join}reveal=${data}`);
}

/**
 * Ask the email provider whether one booking alert arrived.
 *
 * Read-only: nothing is sent, and nothing in the business changes. The answer
 * is kept on the operation, so it is there for the next person who asks.
 */
export async function checkEmailDelivery(formData: FormData): Promise<void> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const bookingId = String(formData.get("bookingId") ?? "");
  const index = Number(formData.get("index") ?? -1);
  if (!/^[0-9a-f-]{36}$/i.test(organizationId) || !/^[0-9a-f-]{36}$/i.test(bookingId)) return;
  const back = `/admin/organizations/${organizationId}?tab=bookings`;

  // The reference is read again here, never taken from the form.
  const booking = (await listRecentBookings(organizationId, 100)).find((entry) => entry.id === bookingId);
  const attempt = booking?.notifications[index];
  if (!booking || !attempt || attempt.channel !== "email") redirect(`${back}#booking-${bookingId}`);

  const supabase = asFlexibleClient(await createClient());
  const { data: operation, error } = await supabase.rpc("admin_operation_start", {
    p_organization_id: organizationId,
    p_tool: "check_delivery",
    p_target_type: "booking_alert",
    p_target_id: bookingId,
    p_reason: null,
    p_key: `check_delivery:${bookingId}:${index}:${randomUUID()}`,
    p_preview: { attempt: index, audience: attempt.audience },
  });
  if (error || typeof operation !== "string") redirect(`${back}#booking-${bookingId}`);

  const answer = attempt.ref ? await fetchEmailStatus(attempt.ref) : ({ known: false, reason: "No provider reference was saved for this email." } as const);
  await supabase.rpc("admin_operation_finish", {
    p_operation_id: operation,
    p_state: answer.known ? "verified" : "unknown",
    p_result: answer.known ? { attempt: index, last_event: answer.lastEvent } : { attempt: index, why: answer.reason },
  });
  redirect(`${back}&checked=${operation}#booking-${bookingId}`);
}

