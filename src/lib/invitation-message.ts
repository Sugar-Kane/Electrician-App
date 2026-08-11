/**
 * What an invitation says, and what a link to it looks like.
 *
 * Import-free so it can be tested without a database or a mail provider. The
 * email is the only thing the recipient sees before they decide whether this is
 * real, so it names the business, names the person who sent it, and says
 * plainly that the address matters — an invite accepted from the wrong Gmail is
 * the most likely way this goes wrong.
 */

export type InvitationFacts = {
  organizationName: string;
  /** The address it was sent to. Shown, because the account must match it. */
  email: string;
  inviterName: string;
  role: string;
  link: string;
  expiresInDays: number;
};

const ROLE_LABELS: Record<string, string> = {
  owner: "an owner",
  admin: "an administrator",
  dispatcher: "a dispatcher",
  technician: "a technician",
  accountant: "an accountant",
};

export function roleLabel(role: string): string {
  return ROLE_LABELS[role] ?? "a team member";
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The invitation email.
 *
 * The link is the whole point, so it appears as text as well as a button — a
 * mail client that strips styling, or a phone that will not open a button,
 * still leaves something the recipient can copy.
 */
export function invitationEmail(facts: InvitationFacts): {
  subject: string;
  text: string;
  html: string;
} {
  const who = facts.inviterName.trim() || "Someone";
  const role = roleLabel(facts.role);
  const days = facts.expiresInDays;

  const subject = `${who} invited you to ${facts.organizationName} on Volteira`;

  const text = [
    `${who} invited you to join ${facts.organizationName} as ${role}.`,
    "",
    "Open this link to accept:",
    facts.link,
    "",
    `Sign in with ${facts.email} — the invitation only works for that address.`,
    `It expires in ${days} ${days === 1 ? "day" : "days"}.`,
    "",
    "Volteira is the scheduling, invoicing, and phone-answering app the business runs on.",
    "If you were not expecting this, you can ignore it and nothing happens.",
  ].join("\n");

  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;color:#0f172a">',
    `<p>${escapeHtml(who)} invited you to join <strong>${escapeHtml(facts.organizationName)}</strong> as ${escapeHtml(role)}.</p>`,
    `<p><a href="${escapeHtml(facts.link)}" style="display:inline-block;background:#ffc21c;color:#071723;font-weight:700;padding:12px 22px;border-radius:12px;text-decoration:none">Accept the invitation</a></p>`,
    `<p style="font-size:14px;color:#475569">Or copy this link:<br><span style="word-break:break-all">${escapeHtml(facts.link)}</span></p>`,
    `<p style="font-size:14px;color:#475569">Sign in with <strong>${escapeHtml(facts.email)}</strong> — the invitation only works for that address. It expires in ${days} ${days === 1 ? "day" : "days"}.</p>`,
    '<p style="font-size:14px;color:#475569">Volteira is the scheduling, invoicing, and phone-answering app the business runs on. If you were not expecting this, you can ignore it and nothing happens.</p>',
    "</div>",
  ].join("");

  return { subject, text, html };
}

/** Where an invitation token is accepted. */
export function invitationLink(origin: string, token: string): string {
  return `${origin.replace(/\/+$/, "")}/invite/${encodeURIComponent(token)}`;
}

/**
 * What each outcome of accepting means, in words for the person holding the
 * link rather than the developer reading the log.
 */
export function acceptOutcome(status: string): { heading: string; detail: string; ok: boolean } {
  switch (status) {
    case "joined":
      return { heading: "You're in.", detail: "Opening the business now.", ok: true };
    case "already_member":
      return { heading: "You're already in.", detail: "This invitation was accepted with this account.", ok: true };
    case "wrong_email":
      return {
        heading: "This invitation is for a different address",
        detail:
          "You are signed in with another account. Sign out and sign in with the address the invitation was sent to.",
        ok: false,
      };
    case "unconfirmed_email":
      return {
        heading: "Confirm your email first",
        detail: "Open the confirmation link we sent when you created the account, then come back here.",
        ok: false,
      };
    case "expired":
      return {
        heading: "This invitation has expired",
        detail: "Ask whoever invited you to send a new one — it only takes a moment.",
        ok: false,
      };
    case "revoked":
      return {
        heading: "This invitation was cancelled",
        detail: "Ask whoever invited you to send a new one.",
        ok: false,
      };
    case "accepted":
      return {
        heading: "This invitation has already been used",
        detail: "Someone accepted it with a different account. Ask for a new one.",
        ok: false,
      };
    case "signed_out":
      return { heading: "Sign in to continue", detail: "You need an account before you can join.", ok: false };
    default:
      return {
        heading: "This invitation is not valid",
        detail: "Check that you copied the whole link, or ask for a new invitation.",
        ok: false,
      };
  }
}
