/**
 * What a customer and an owner are told once a booking is real.
 *
 * Composing these is separated from sending them because the wording is the
 * part that matters and the part that is easy to get wrong: a confirmation that
 * omits the arrival window is useless, and one that promises something the
 * business did not agree to is worse than none. Sending is a network call;
 * this is the promise.
 *
 * Import-free so every message can be read in a test rather than in an inbox.
 */

export type BookingFacts = {
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** "Mon, Aug 10, 8:00 AM-10:00 AM", already in the business's timezone. */
  slotLabel: string;
  addressLine1: string;
  city: string;
  diagnosticFee: string;
  description: string;
  /** The public confirmation page for this booking, when there is one. */
  link?: string;
};

/** Two SMS segments. Past this a message arrives split and looks broken. */
const SMS_LIMIT = 320;

function squash(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function clip(value: string, limit: number): string {
  const text = squash(value);
  return text.length > limit ? `${text.slice(0, limit - 1).trimEnd()}…` : text;
}

/**
 * The customer's confirmation.
 *
 * Leads with the window, because that is the one fact they will want to check
 * later. The link goes last so that a message truncated by a carrier still
 * carries the appointment itself.
 */
export function customerConfirmationSms(facts: BookingFacts): string {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  const parts = [
    `${facts.businessName}: you're booked for ${facts.slotLabel}`,
    address ? ` at ${address}` : "",
    `. The diagnostic visit is ${facts.diagnosticFee}.`,
    facts.link ? ` Details: ${facts.link}` : "",
    ` Questions? Call ${facts.businessPhone}.`,
  ];
  return clip(parts.join(""), SMS_LIMIT);
}

/**
 * What the owner gets when a booking lands without them.
 *
 * Written to be readable on a lock screen at 6am: who, when, where, and what is
 * wrong, in that order. No link — this one is for someone who already has the
 * app.
 */
export function ownerBookingSms(facts: BookingFacts): string {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  return clip(
    [
      `New booking: ${facts.slotLabel}.`,
      facts.contactName ? ` ${facts.contactName}.` : "",
      address ? ` ${address}.` : "",
      facts.description ? ` "${clip(facts.description, 120)}"` : "",
    ].join(""),
    SMS_LIMIT,
  );
}

export type EmailBody = { subject: string; text: string; html: string };

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * The same confirmation, for a caller who gave an email address.
 *
 * Plain text and HTML say exactly the same things: a mail client that shows
 * one must not show a customer a different appointment from the other.
 */
export function confirmationEmail(facts: BookingFacts): EmailBody {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  const greeting = facts.contactName ? `Hi ${squash(facts.contactName)},` : "Hi,";

  const lines = [
    greeting,
    "",
    `Your appointment with ${facts.businessName} is booked.`,
    "",
    `When: ${facts.slotLabel}`,
    address ? `Where: ${address}` : "",
    `Diagnostic visit: ${facts.diagnosticFee}`,
    facts.description ? `What you told us: ${squash(facts.description)}` : "",
    "",
    facts.link ? `View this appointment: ${facts.link}` : "",
    `Need to change it, or think something is wrong? Call ${facts.businessPhone}.`,
    "",
    facts.businessName,
  ].filter((line) => line !== "");

  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your appointment with ${escapeHtml(facts.businessName)} is booked.</p>`,
    "<ul>",
    `<li><strong>When:</strong> ${escapeHtml(facts.slotLabel)}</li>`,
    address ? `<li><strong>Where:</strong> ${escapeHtml(address)}</li>` : "",
    `<li><strong>Diagnostic visit:</strong> ${escapeHtml(facts.diagnosticFee)}</li>`,
    facts.description
      ? `<li><strong>What you told us:</strong> ${escapeHtml(squash(facts.description))}</li>`
      : "",
    "</ul>",
    facts.link
      ? `<p><a href="${escapeHtml(facts.link)}">View this appointment</a></p>`
      : "",
    `<p>Need to change it, or think something is wrong? Call ${escapeHtml(facts.businessPhone)}.</p>`,
    `<p>${escapeHtml(facts.businessName)}</p>`,
  ]
    .filter(Boolean)
    .join("");

  return {
    subject: `Your ${facts.businessName} appointment: ${facts.slotLabel}`,
    text: lines.join("\n"),
    html,
  };
}

/**
 * The From line, so the customer sees who is actually writing to them.
 *
 * A confirmation from "bookings@volteira.com" is from software the customer has
 * never heard of; the same address labelled with the business name is from the
 * electrician they just called. The address is the platform's because the
 * platform holds the verified domain — the name is the tenant's because that is
 * whose appointment it is.
 *
 * A configured value that already carries a display name is left alone, so a
 * deployment can override this entirely.
 */
export function emailSender(businessName: string, configured: string): string {
  const address = configured.trim();
  if (!address) return "";
  if (address.includes("<")) return address;

  // A quote, a comma, or an angle bracket would break the header apart. `@` is
  // stripped too: a display name that reads like an address is the shape of a
  // phishing header, and no business name needs one.
  const name = businessName.replace(/["\\<>,;:@]/g, " ").replace(/\s+/g, " ").trim().slice(0, 78);
  return name ? `${name} <${address}>` : address;
}

/**
 * Whether an address is worth attempting delivery to.
 *
 * Speech recognition turns "adam at gmail dot com" into things that are not
 * addresses. This refuses the obvious failures rather than queueing mail that
 * can only bounce — the booking is already made either way.
 */
export function looksLikeEmail(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 6 || trimmed.length > 254) return false;
  if (/\s/.test(trimmed)) return false;
  return /^[^@]+@[^@.]+\.[^@]{2,}$/.test(trimmed);
}
