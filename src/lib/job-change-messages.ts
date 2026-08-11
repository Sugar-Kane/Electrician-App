/**
 * What a customer is told when their appointment moves or is called off.
 *
 * The person on the other end has arranged their day around a two-hour window
 * and, for a diagnostic visit, has often taken time off work. So these say the
 * three things that decide what they do next — what has happened, when it was
 * going to be, and how to reach a human — before anything else.
 *
 * Import-free, so the wording can be tested without a provider.
 */

export type JobChangeFacts = {
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** The window as it stood, e.g. "Tue, Aug 11, 8:00 AM-10:00 AM". */
  slotLabel: string;
  /** Where it has moved to. Only used by the reschedule messages. */
  newSlotLabel?: string;
  /** Optional, in the business's own words. Shown to the customer verbatim. */
  reason?: string;
};

/** Two SMS segments. Beyond this carriers split the message and may reorder. */
const SMS_LIMIT = 320;

function firstName(value: string): string {
  const first = value.trim().split(/\s+/)[0] ?? "";
  return first;
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
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
 * The cancellation text.
 *
 * Leads with the cancellation rather than with the business name, because on a
 * lock screen the first few words are all that is read, and "your appointment
 * is cancelled" is the part that changes somebody's morning.
 */
export function cancellationSms(facts: JobChangeFacts): string {
  const name = firstName(facts.contactName);
  const reason = facts.reason?.trim() ? ` ${clamp(facts.reason, 90)}` : "";
  // Without a name the sentence starts at "your", which has to be capitalised
  // or the text opens mid-sentence.
  const opening = name ? `${name}, your` : "Your";

  const message = [
    `${opening} ${facts.businessName} appointment on ${facts.slotLabel} has been canceled.`,
    reason,
    ` Call ${facts.businessPhone} to rebook.`,
  ].join("");

  return clamp(message, SMS_LIMIT);
}

/** The reschedule text. Both windows, old first, so the change is legible. */
export function rescheduleSms(facts: JobChangeFacts): string {
  const name = firstName(facts.contactName);
  const opening = name ? `${name}, your` : "Your";

  const message =
    `${opening} ${facts.businessName} appointment has moved from ${facts.slotLabel} ` +
    `to ${facts.newSlotLabel ?? "a new time"}. Call ${facts.businessPhone} if that does not work.`;

  return clamp(message, SMS_LIMIT);
}

type Mail = { subject: string; text: string; html: string };

function wrap(lines: string[]): string {
  return [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;color:#0f172a">',
    ...lines,
    "</div>",
  ].join("");
}

export function cancellationEmail(facts: JobChangeFacts): Mail {
  const name = firstName(facts.contactName);
  const greeting = name ? `Hi ${name},` : "Hello,";
  const reason = facts.reason?.trim() ?? "";

  const subject = `Canceled: your ${facts.businessName} appointment on ${facts.slotLabel}`;

  const text = [
    greeting,
    "",
    `Your appointment with ${facts.businessName} on ${facts.slotLabel} has been canceled.`,
    ...(reason ? ["", reason] : []),
    "",
    `Nothing further is needed from you. To rebook, call ${facts.businessPhone}.`,
    "",
    facts.businessName,
  ].join("\n");

  const html = wrap([
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your appointment with <strong>${escapeHtml(facts.businessName)}</strong> on <strong>${escapeHtml(facts.slotLabel)}</strong> has been canceled.</p>`,
    ...(reason ? [`<p>${escapeHtml(reason)}</p>`] : []),
    `<p>Nothing further is needed from you. To rebook, call <a href="tel:${escapeHtml(facts.businessPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(facts.businessPhone)}</a>.</p>`,
    `<p style="color:#475569">${escapeHtml(facts.businessName)}</p>`,
  ]);

  return { subject, text, html };
}

export function rescheduleEmail(facts: JobChangeFacts): Mail {
  const name = firstName(facts.contactName);
  const greeting = name ? `Hi ${name},` : "Hello,";
  const next = facts.newSlotLabel ?? "a new time";
  const reason = facts.reason?.trim() ?? "";

  const subject = `Moved: your ${facts.businessName} appointment is now ${next}`;

  const text = [
    greeting,
    "",
    `Your appointment with ${facts.businessName} has moved.`,
    "",
    `Was: ${facts.slotLabel}`,
    `Now: ${next}`,
    ...(reason ? ["", reason] : []),
    "",
    `If the new time does not work, call ${facts.businessPhone}.`,
    "",
    facts.businessName,
  ].join("\n");

  const html = wrap([
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your appointment with <strong>${escapeHtml(facts.businessName)}</strong> has moved.</p>`,
    `<p style="color:#475569">Was: ${escapeHtml(facts.slotLabel)}</p>`,
    `<p><strong>Now: ${escapeHtml(next)}</strong></p>`,
    ...(reason ? [`<p>${escapeHtml(reason)}</p>`] : []),
    `<p>If the new time does not work, call <a href="tel:${escapeHtml(facts.businessPhone.replace(/[^\d+]/g, ""))}">${escapeHtml(facts.businessPhone)}</a>.</p>`,
    `<p style="color:#475569">${escapeHtml(facts.businessName)}</p>`,
  ]);

  return { subject, text, html };
}

/**
 * Whether a change is worth telling the customer about at all.
 *
 * Editing an access note or reassigning which electrician turns up is the
 * business's own business. Moving the time somebody has taken off work for is
 * not, and neither is calling it off.
 */
export function changeNeedsCustomerNotice(input: {
  canceled: boolean;
  previousStart: string;
  nextStart: string;
  previousEnd: string;
  nextEnd: string;
}): boolean {
  if (input.canceled) return true;
  return input.previousStart !== input.nextStart || input.previousEnd !== input.nextEnd;
}
