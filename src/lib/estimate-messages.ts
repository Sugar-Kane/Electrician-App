import { emailButton } from "./email-layout.ts";
import { escapeHtml, formatMoney } from "./invoice-messages.ts";

/**
 * What a customer is sent with an estimate: the total they will pay for the
 * work, to read and keep. Nothing to sign and nothing due — that comes with
 * the contract and the invoice, if they go ahead.
 *
 * Laid out like the invoice messages so the two read as one business's
 * paperwork. The admin fee is already inside the total and never mentioned.
 *
 * Import-free apart from the shared wording helpers, so it can be tested.
 */

export type EstimateFacts = {
  businessName: string;
  businessPhone: string;
  contactName: string;
  /** As shown to a human, e.g. "EST-12". */
  estimateNumber: string;
  /** Dollars, not cents: what the customer will pay. */
  total: number;
  /** e.g. "Dec 13, 2026". Empty when the estimate has no end date. */
  validUntilLabel: string;
  /** What the work is, in the business's words. */
  workSummary?: string;
  /** The customer's link to the estimate. */
  viewUrl?: string;
};

const SMS_LIMIT = 320;

function firstName(value: string): string {
  return value.trim().split(/\s+/)[0] ?? "";
}

function clamp(value: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length <= max) return trimmed;
  return `${trimmed.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function estimateSms(facts: EstimateFacts): string {
  const name = firstName(facts.contactName);
  const opening = name ? `${name}: your` : "Your";
  const link = facts.viewUrl ? ` See it here: ${facts.viewUrl}` : "";
  return clamp(
    `${opening} estimate from ${facts.businessName} is ready. Total for the work: ${formatMoney(facts.total)}.${link} ` +
      `Questions? Call ${facts.businessPhone}.`,
    SMS_LIMIT,
  );
}

export function estimateEmail(facts: EstimateFacts): { subject: string; text: string; html: string } {
  const name = firstName(facts.contactName);
  const greeting = name ? `Hi ${name},` : "Hello,";
  const amount = formatMoney(facts.total);
  const summary = facts.workSummary?.trim() ?? "";
  const subject = `${facts.businessName}: your estimate for ${amount}`;

  const text = [
    greeting,
    "",
    `Here is your estimate from ${facts.businessName}.`,
    "",
    `Estimate: ${facts.estimateNumber}`,
    `Total: ${amount}`,
    ...(facts.validUntilLabel ? [`Valid until: ${facts.validUntilLabel}`] : []),
    ...(summary ? ["", `For: ${summary}`] : []),
    "",
    "This is the total you will pay for the work. There is nothing to sign and nothing is due now.",
    ...(facts.viewUrl ? ["", `See your estimate: ${facts.viewUrl}`] : []),
    "",
    `Questions, or ready to book? Call ${facts.businessPhone}.`,
    "",
    facts.businessName,
  ].join("\n");

  const telHref = facts.businessPhone.replace(/[^\d+]/g, "");
  const row = (label: string, value: string, strong = true) =>
    `<tr><td style="padding:4px 24px 4px 0;color:#475569">${escapeHtml(label)}</td><td style="padding:4px 0">${
      strong ? `<strong>${escapeHtml(value)}</strong>` : escapeHtml(value)
    }</td></tr>`;
  const html = [
    '<div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;font-size:16px;line-height:1.6;color:#0f172a">',
    `<p>${escapeHtml(greeting)}</p>`,
    `<p>Here is your estimate from <strong>${escapeHtml(facts.businessName)}</strong>.</p>`,
    '<table style="border-collapse:collapse;margin:16px 0">',
    row("Estimate", facts.estimateNumber),
    row("Total", amount),
    ...(facts.validUntilLabel ? [row("Valid until", facts.validUntilLabel, false)] : []),
    "</table>",
    ...(summary ? [`<p style="color:#475569">For: ${escapeHtml(summary)}</p>`] : []),
    "<p>This is the total you will pay for the work. There is nothing to sign and nothing is due now.</p>",
    ...(facts.viewUrl ? [`<p>${emailButton(facts.viewUrl, "See your estimate")}</p>`] : []),
    `<p>Questions, or ready to book? Call <a href="tel:${escapeHtml(telHref)}">${escapeHtml(facts.businessPhone)}</a>.</p>`,
    `<p style="color:#475569">${escapeHtml(facts.businessName)}</p>`,
    "</div>",
  ].join("");

  return { subject, text, html };
}

/** The customer's link to the estimate, or nothing when it cannot be built. */
export function estimateViewUrl(origin: string, token: string): string | undefined {
  const base = origin.replace(/\/+$/, "");
  return base && /^[0-9a-f-]{36}$/i.test(token) ? `${base}/estimate/${token}` : undefined;
}
