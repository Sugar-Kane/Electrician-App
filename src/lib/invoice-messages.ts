/**
 * What a customer is sent when they are asked to pay.
 *
 * An invoice arriving by text is read on a lock screen by somebody who has
 * already had the work done and mostly wants to know two things: how much, and
 * where do I pay. Those go first. The invoice number matters to the business
 * and almost nothing to the customer, so it comes after.
 *
 * A pay link is included when Stripe has issued one. Without it the message has
 * to tell the customer what to do instead — an invoice that says "$1,280 due"
 * and gives no way to settle it is a demand, not a bill.
 *
 * Import-free, so the wording can be tested without a provider.
 */

export type InvoiceFacts = {
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** As shown to a human, e.g. "INV-10024". */
  invoiceNumber: string;
  /** Dollars, not cents. */
  amountDue: number;
  /** e.g. "Aug 21, 2026". Empty when the invoice carries no due date. */
  dueLabel: string;
  /** Stripe's hosted payment page, when the invoice has one. */
  payUrl?: string;
  /** What the work was, in the business's words. Optional. */
  workSummary?: string;
};

/** Two SMS segments. Beyond this carriers split the message and may reorder. */
const SMS_LIMIT = 320;

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
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
 * Money, the way it is written on a bill.
 *
 * Always two decimal places: "$1,280" and "$1,280.00" are the same number, but
 * only one of them looks like a figure somebody checked.
 */
export function formatMoney(amount: number): string {
  const safe = Number.isFinite(amount) ? amount : 0;
  const fixed = Math.abs(safe).toFixed(2);
  const [whole = "0", cents = "00"] = fixed.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${safe < 0 ? "-" : ""}$${grouped}.${cents}`;
}

/**
 * The text message.
 *
 * The amount leads. Everything else in this message is context for a number
 * the customer is deciding whether to act on today.
 */
export function invoiceSms(facts: InvoiceFacts): string {
  const name = firstName(facts.contactName);
  const opening = name ? `${name}: your` : "Your";
  const due = facts.dueLabel ? ` due ${facts.dueLabel}` : "";

  const settle = facts.payUrl
    ? ` Pay: ${facts.payUrl}`
    : ` Call ${facts.businessPhone} to pay.`;

  const message =
    `${opening} ${facts.businessName} invoice ${facts.invoiceNumber} for ` +
    `${formatMoney(facts.amountDue)} is ready${due}.${settle}`;

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

/**
 * The email.
 *
 * The subject line carries the amount, because a subject reading "Invoice from
 * Pacific Plains Electric" tells somebody scanning an inbox nothing they can
 * act on.
 */
export function invoiceEmail(facts: InvoiceFacts): Mail {
  const name = firstName(facts.contactName);
  const greeting = name ? `Hi ${name},` : "Hello,";
  const amount = formatMoney(facts.amountDue);
  const summary = facts.workSummary?.trim() ?? "";
  const due = facts.dueLabel ? `Due ${facts.dueLabel}.` : "";

  const subject = `${facts.businessName}: invoice ${facts.invoiceNumber} for ${amount}`;

  const text = [
    greeting,
    "",
    `Your invoice from ${facts.businessName} is ready.`,
    "",
    `Invoice: ${facts.invoiceNumber}`,
    `Amount due: ${amount}`,
    ...(due ? [due] : []),
    ...(summary ? ["", `For: ${summary}`] : []),
    "",
    facts.payUrl
      ? `Pay online: ${facts.payUrl}`
      : `To pay, call ${facts.businessPhone}.`,
    "",
    `Questions about this invoice? Call ${facts.businessPhone}.`,
    "",
    facts.businessName,
  ].join("\n");

  const telHref = facts.businessPhone.replace(/[^\d+]/g, "");

  const html = wrap([
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Your invoice from <strong>${escapeHtml(facts.businessName)}</strong> is ready.</p>`,
    '<table style="border-collapse:collapse;margin:16px 0">',
    `<tr><td style="padding:4px 24px 4px 0;color:#475569">Invoice</td><td style="padding:4px 0"><strong>${escapeHtml(facts.invoiceNumber)}</strong></td></tr>`,
    `<tr><td style="padding:4px 24px 4px 0;color:#475569">Amount due</td><td style="padding:4px 0"><strong>${escapeHtml(amount)}</strong></td></tr>`,
    ...(facts.dueLabel
      ? [
          `<tr><td style="padding:4px 24px 4px 0;color:#475569">Due</td><td style="padding:4px 0">${escapeHtml(facts.dueLabel)}</td></tr>`,
        ]
      : []),
    "</table>",
    ...(summary ? [`<p style="color:#475569">For: ${escapeHtml(summary)}</p>`] : []),
    facts.payUrl
      ? `<p><a href="${escapeHtml(facts.payUrl)}" style="display:inline-block;background:#0f172a;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600">Pay ${escapeHtml(amount)}</a></p>`
      : `<p>To pay, call <a href="tel:${escapeHtml(telHref)}">${escapeHtml(facts.businessPhone)}</a>.</p>`,
    `<p>Questions about this invoice? Call <a href="tel:${escapeHtml(telHref)}">${escapeHtml(facts.businessPhone)}</a>.</p>`,
    `<p style="color:#475569">${escapeHtml(facts.businessName)}</p>`,
  ]);

  return { subject, text, html };
}

export type DeliveryChannel = "sms" | "email";

export type DeliveryAttempt = {
  channel: DeliveryChannel;
  to: string;
  ok: boolean;
  detail: string;
  at: string;
};

/**
 * One line saying how it went, for the person who pressed the button.
 *
 * Partial success is the common case — a customer with an email address and no
 * mobile — and it is neither a success nor a failure, so it must not be
 * reported as either.
 */
export function describeDelivery(attempts: DeliveryAttempt[]): {
  ok: boolean;
  message: string;
} {
  if (attempts.length === 0) {
    return { ok: false, message: "Nothing was sent: no delivery method was chosen." };
  }

  const sent = attempts.filter((attempt) => attempt.ok);
  const failed = attempts.filter((attempt) => !attempt.ok);
  const name = (channel: DeliveryChannel) => (channel === "sms" ? "text" : "email");

  if (failed.length === 0) {
    const channels = sent.map((attempt) => name(attempt.channel)).join(" and ");
    return { ok: true, message: `Invoice sent by ${channels}.` };
  }

  if (sent.length === 0) {
    // The reason, not a summary of it. "Could not send" sends somebody looking
    // through logs for something the screen already knew.
    return { ok: false, message: failed.map((attempt) => attempt.detail).join(" ") };
  }

  const sentNames = sent.map((attempt) => name(attempt.channel)).join(" and ");
  const problems = failed.map((attempt) => `${name(attempt.channel)}: ${attempt.detail}`).join(" ");
  return { ok: true, message: `Sent by ${sentNames}. ${problems}` };
}

/**
 * Whether there is any point sending this invoice.
 *
 * A paid invoice arriving by text reads as a second demand for money already
 * handed over, which is the kind of mistake a customer tells other people
 * about. A zero balance is the same thing.
 */
export function invoiceCanBeSent(input: {
  status: string;
  amountDue: number;
}): { ok: true } | { ok: false; reason: string } {
  if (input.status.toLowerCase() === "paid") {
    return { ok: false, reason: "This invoice is already paid." };
  }
  if (!(input.amountDue > 0)) {
    return { ok: false, reason: "This invoice has nothing left to pay." };
  }
  return { ok: true };
}
