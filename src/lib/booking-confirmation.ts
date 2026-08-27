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
  /** What was asked on the call, and what the customer said. */
  intakeAnswers?: { question: string; answer: string }[];
  /** The caller's number, so the owner can ring them back from the email. */
  customerPhone?: string;
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
export function ownerBookingSms(facts: BookingFacts, held = false): string {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  return clip(
    [
      // A held time is not a booking yet, and telling the owner it is means he
      // plans a day around an appointment that may never be paid for.
      held ? `Held (unpaid): ${facts.slotLabel}.` : `New booking: ${facts.slotLabel}.`,
      facts.contactName ? ` ${facts.contactName}.` : "",
      address ? ` ${address}.` : "",
      facts.description ? ` "${clip(facts.description, 120)}"` : "",
    ].join(""),
    SMS_LIMIT,
  );
}

/**
 * The intake, as a second message to the owner.
 *
 * Deliberately separate rather than crammed into the first: the booking text
 * has to survive a lock screen, and the answers are what gets read sitting down
 * with a coffee. Sent only when there is something to send, and split so a long
 * interview does not arrive as one truncated wall.
 */
export function ownerIntakeSms(facts: BookingFacts): string {
  const answers = facts.intakeAnswers ?? [];
  if (answers.length === 0) return "";

  const lines = answers.map((entry, index) => `${index + 1}. ${squash(entry.question)} — ${squash(entry.answer)}`);
  return clip(
    [`What ${facts.contactName || "the caller"} said:`, ...lines].join(" "),
    SMS_LIMIT * 2,
  );
}

export type EmailBody = { subject: string; text: string; html: string };

/**
 * The owner's copy, which is a work order rather than a reassurance.
 *
 * The customer's email tells them not to worry. This one has to be enough to
 * load a van from: what is wrong, where, when, and everything the caller said
 * when asked. It leads with the window because that is what decides the day.
 */
export function ownerBookingEmail(facts: BookingFacts, jobUrl?: string): EmailBody {
  const address = [facts.addressLine1, facts.city].filter(Boolean).join(", ");
  const answers = facts.intakeAnswers ?? [];

  const lines = [
    `${facts.slotLabel}`,
    address ? `${address}` : "",
    facts.contactName ? `${squash(facts.contactName)}${facts.customerPhone ? ` — ${facts.customerPhone}` : ""}` : "",
    "",
    facts.description ? `Problem: ${squash(facts.description)}` : "",
    "",
    ...(answers.length > 0 ? ["What they said on the call:"] : []),
    ...answers.flatMap((entry) => [`  ${squash(entry.question)}`, `    ${squash(entry.answer)}`]),
    "",
    `Deposit: ${facts.diagnosticFee}`,
    jobUrl ? `Open the job: ${jobUrl}` : "",
  ].filter((line) => line !== "");

  const html = [
    `<p style="font-size:18px;margin:0 0 4px"><strong>${escapeHtml(facts.slotLabel)}</strong></p>`,
    address ? `<p style="margin:0 0 4px">${escapeHtml(address)}</p>` : "",
    facts.contactName
      ? `<p style="margin:0 0 16px">${escapeHtml(squash(facts.contactName))}${facts.customerPhone ? ` — <a href="tel:${escapeHtml(facts.customerPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(facts.customerPhone)}</a>` : ""}</p>`
      : "",
    facts.description
      ? `<p><strong>Problem:</strong> ${escapeHtml(squash(facts.description))}</p>`
      : "",
    ...(answers.length > 0
      ? [
          "<p><strong>What they said on the call:</strong></p><ul>",
          ...answers.map(
            (entry) =>
              `<li>${escapeHtml(squash(entry.question))}<br /><strong>${escapeHtml(squash(entry.answer))}</strong></li>`,
          ),
          "</ul>",
        ]
      : []),
    `<p><strong>Deposit:</strong> ${escapeHtml(facts.diagnosticFee)}</p>`,
    jobUrl ? `<p><a href="${escapeHtml(jobUrl)}">Open the job</a></p>` : "",
  ]
    .filter(Boolean)
    .join("");

  const who = facts.contactName ? ` — ${squash(facts.contactName)}` : "";
  return {
    subject: `New booking: ${facts.slotLabel}${who}`,
    text: lines.join("\n"),
    html,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * What is known when nothing could be booked.
 *
 * A separate type rather than a loosened `BookingFacts`, because every field
 * that makes a booking message a booking message — the window, the address, the
 * fee — is absent here, and making them optional would let a caller build a
 * confirmation that quietly promises nothing.
 */
export type CallbackFacts = {
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** The number to ring them back on, already normalised. */
  customerPhone: string;
  /** What they need, in their own words. */
  description: string;
  urgency: "routine" | "urgent";
  /** Which the customer chose when asked: somebody now, or a call later. */
  when: "now" | "later";
  intakeAnswers?: { question: string; answer: string }[];
  /** The booking-requests list, for the owner's email. */
  link?: string;
};

/**
 * The owner's alert when a call produced no booking.
 *
 * Until this existed a callback reached nobody at all: both intake paths only
 * sent on a booking, so the one outcome that exists *because* a person has to
 * ring somebody back was the one outcome no person heard about. The owner found
 * it by opening the app.
 *
 * "Now" leads with the fact that they are waiting, because that is the whole
 * difference between a text read at leisure and one acted on. Both versions say
 * plainly that nothing is scheduled — a message that merely names a customer
 * and a problem reads like a booking at a glance.
 */
export function ownerCallbackSms(facts: CallbackFacts): string {
  const who = squash(facts.contactName) || "A caller";
  const lead =
    facts.when === "now"
      ? `${who} is asking for a call back now — ${facts.customerPhone}.`
      : `Callback requested: ${who}, ${facts.customerPhone}.`;

  return clip(
    [
      lead,
      facts.urgency === "urgent" ? "They called it urgent." : "",
      facts.description ? squash(facts.description) : "",
      // Last, and never omitted. Everything above this reads like a booking.
      "Nothing is scheduled.",
    ]
      .filter(Boolean)
      .join(" "),
    SMS_LIMIT,
  );
}

/**
 * The same, with the interview, for the owner's inbox.
 *
 * Carries the answers because they are what decide whether this is a five
 * minute phone call or a visit, and the owner is about to make that call.
 */
export function ownerCallbackEmail(facts: CallbackFacts): EmailBody {
  const who = squash(facts.contactName) || "A caller";
  const answers = facts.intakeAnswers ?? [];
  const heading =
    facts.when === "now"
      ? `${who} asked for a call back now`
      : `${who} asked for a callback`;

  const lines = [
    heading,
    facts.customerPhone,
    facts.urgency === "urgent" ? "They called it urgent." : "",
    "",
    facts.description ? `What they need: ${squash(facts.description)}` : "",
    "",
    ...(answers.length > 0 ? ["What they said on the call:"] : []),
    ...answers.flatMap((entry) => [`  ${squash(entry.question)}`, `    ${squash(entry.answer)}`]),
    "",
    "Nothing is scheduled. No visit was booked on this call.",
    facts.link ? `Open the request: ${facts.link}` : "",
  ].filter((line) => line !== "");

  const tel = facts.customerPhone.replace(/[^\d+]/g, "");
  const html = [
    `<p style="font-size:18px;margin:0 0 4px"><strong>${escapeHtml(heading)}</strong></p>`,
    `<p style="margin:0 0 16px"><a href="tel:${escapeHtml(tel)}">${escapeHtml(facts.customerPhone)}</a>${
      facts.urgency === "urgent" ? " — <strong>they called it urgent</strong>" : ""
    }</p>`,
    facts.description
      ? `<p><strong>What they need:</strong> ${escapeHtml(squash(facts.description))}</p>`
      : "",
    ...(answers.length > 0
      ? [
          "<p><strong>What they said on the call:</strong></p><ul>",
          ...answers.map(
            (entry) =>
              `<li>${escapeHtml(squash(entry.question))}<br /><strong>${escapeHtml(squash(entry.answer))}</strong></li>`,
          ),
          "</ul>",
        ]
      : []),
    "<p><strong>Nothing is scheduled.</strong> No visit was booked on this call.</p>",
    facts.link ? `<p><a href="${escapeHtml(facts.link)}">Open the request</a></p>` : "",
  ]
    .filter(Boolean)
    .join("");

  return {
    subject:
      facts.when === "now"
        ? `Call back now: ${who}`
        : `Callback requested: ${who}`,
    text: lines.join("\n"),
    html,
  };
}

/**
 * The customer's copy, which has to match what they were just promised.
 *
 * They chose between somebody now and a call later, and were told which they
 * were getting. A text saying the other thing is how a person ends up waiting
 * by a phone all evening for a call that was filed as routine.
 */
export function customerCallbackSms(facts: CallbackFacts): string {
  const promise =
    facts.when === "now"
      ? "an electrician will call you back shortly"
      : "we'll call you back to get you scheduled";

  return clip(
    `${facts.businessName}: thanks for calling. We have your details and ${promise}. Need us sooner? Call ${facts.businessPhone}.`,
    SMS_LIMIT,
  );
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
    ...(facts.intakeAnswers ?? []).flatMap((entry) => [
      `${squash(entry.question)}`,
      `  ${squash(entry.answer)}`,
    ]),
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
    ...(facts.intakeAnswers ?? []).map(
      (entry) =>
        `<li><strong>${escapeHtml(squash(entry.question))}</strong><br />${escapeHtml(squash(entry.answer))}</li>`,
    ),
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
