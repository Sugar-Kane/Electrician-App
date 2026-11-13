/**
 * The look every email from a business on Volteira shares: a navy header band
 * with the business's name over a yellow rule, the message on a white card
 * below it on a pale page, yellow buttons, and a quiet footer. Dark mode is
 * handled by the mail app's own inversion or, where it reads it, the
 * prefers-color-scheme palette.
 *
 * Applied once, in sendEmail, so no email can go out plain. Tables and inline
 * styles because that is what mail apps render; the <style> block only adds
 * what clients that read it can use (link colour, dark-mode hints).
 *
 * Import-free, so it can be read in a test.
 */

const NAVY = "#06131d";
const YELLOW = "#ffc21c";
const INK = "#0f172a";
const MUTED = "#64748b";
/** The page behind the card: a pale grey every mail app can darken cleanly. */
const PAGE = "#eef2f6";
const RULE = "#e2e8f0";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A yellow button, for the one thing the email asks the reader to do. */
export function emailButton(href: string, label: string): string {
  return `<a href="${escape(href)}" class="btn" style="display:inline-block;background:${YELLOW};color:${NAVY};font-weight:700;padding:13px 24px;border-radius:12px;text-decoration:none;font-size:16px">${escape(label)}</a>`;
}

/** The display name from a From line ("Pacific Plains Electric <bookings@…>"), or "". */
export function senderName(from: string): string {
  const match = /^\s*"?([^"<]+?)"?\s*</.exec(from);
  return match ? match[1]!.trim() : "";
}

/** True when the html is already a whole document, which is left as it is. */
export function isWholeDocument(html: string): boolean {
  return /<html[\s>]/i.test(html);
}

/** A phone number as dialled: digits and a leading +, or "" when it is not one. */
export function dialable(phone: string | null | undefined): string {
  const cleaned = (phone ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");
  return cleaned.replace(/\D/g, "").length >= 7 ? cleaned : "";
}

/** Call and Text, side by side, for a customer to reach the business in one tap. */
export function contactButtons(phone: string): string {
  const number = dialable(phone);
  if (!number) return "";
  const button = (href: string, label: string) =>
    `<a href="${escape(href)}" style="display:block;background:#f1f5f9;color:${NAVY};border:1px solid #cbd5e1;font-weight:700;padding:12px 10px;border-radius:12px;text-decoration:none;font-size:15px;text-align:center">${escape(label)}</a>`;
  return `<table role="presentation" class="contact" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:8px;border-top:1px solid ${RULE};">
    <tr><td colspan="3" style="padding:16px 0 8px;font-size:13px;color:${MUTED};">Questions? Reach us directly.</td></tr>
    <tr>
      <td width="50%" style="padding:0 6px 0 0;">${button(`tel:${number}`, "Call")}</td>
      <td width="50%" style="padding:0 0 0 6px;">${button(`sms:${number}`, "Text")}</td>
    </tr>
  </table>`;
}

export function brandedEmail(input: {
  /** The message itself: paragraphs, tables, links. */
  html: string;
  /** Shown in the header; the business sending it. */
  businessName: string;
  /** The line inbox previews show under the subject. */
  preheader?: string;
  /**
   * The business's logo drawn for a navy header (email-logo.ts), a public URL.
   * It names the business itself, so it takes the name's place; without one,
   * the name.
   */
  logoUrl?: string;
  /** The number a customer should call or text; adds Call and Text buttons under the message. */
  contactPhone?: string;
}): string {
  if (isWholeDocument(input.html)) return input.html;
  const name = escape(input.businessName.trim() || "Volteira");
  // Only an https image: a mail app blocks anything else, and a broken image
  // in the header is worse than the name alone.
  const logo = /^https:\/\//.test(input.logoUrl ?? "") ? escape(input.logoUrl as string) : "";
  const preheader = escape((input.preheader ?? "").replace(/\s+/g, " ").trim().slice(0, 140));
  /*
   * Light first, on purpose. A whole dark frame read well in a light inbox, but
   * a mail app in dark mode drew its own white margin around it (the navy box
   * floating on white), and some apps half-inverted it. A light page with a
   * navy header band is what every app knows how to darken: Gmail and Outlook
   * invert it as a whole, and Apple Mail, which honours prefers-color-scheme,
   * gets the dark palette below. The header band stays navy in both.
   */
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>${name}</title>
<style>
  :root { color-scheme: light dark; supported-color-schemes: light dark; }
  .card a { color: #9a6b00; }
  .card p { margin: 0 0 14px; }
  .card table td { vertical-align: top; }
  @media (max-width: 600px) { .card { padding: 22px 18px !important; } }
  @media (prefers-color-scheme: dark) {
    .page { background: #05090d !important; }
    .head { border: 1px solid #22313d !important; border-bottom: 0 !important; }
    .card { background: #111c26 !important; color: #e2e8f0 !important; border-color: #22313d !important; }
    .card p, .card td, .card div, .card span, .card li, .card strong { color: #e2e8f0 !important; }
    .card a { color: ${YELLOW} !important; }
    .card .btn, .card a[style*="background"] { color: ${NAVY} !important; }
    .foot, .foot span { color: #8aa0b0 !important; }
    .contact { border-top-color: #22313d !important; }
  }
</style>
</head>
<body class="page" style="margin:0;padding:0;background:${PAGE};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${PAGE}">${preheader}</div>
<table role="presentation" class="page" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${PAGE};">
  <tr>
    <td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          ${logo
            ? `<td class="head" style="background:${NAVY};border-radius:18px 18px 0 0;padding:20px 28px 16px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <img src="${logo}" alt="${name}" width="220" style="display:block;width:220px;max-width:100%;height:auto;border:0;">
            <div style="margin-top:14px;height:4px;width:56px;border-radius:4px;background:${YELLOW};line-height:4px;font-size:0;">&nbsp;</div>
          </td>`
            : `<td class="head" style="background:${NAVY};border-radius:18px 18px 0 0;padding:22px 28px 18px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <div style="font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#ffffff;">${name}</div>
            <div style="margin-top:10px;height:4px;width:56px;border-radius:4px;background:${YELLOW};line-height:4px;font-size:0;">&nbsp;</div>
          </td>`}
        </tr>
        <tr>
          <td class="card" style="background:#ffffff;border-radius:0 0 18px 18px;border:1px solid ${RULE};border-top:0;padding:28px 28px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:${INK};">
            ${input.html}
            ${contactButtons(input.contactPhone ?? "")}
          </td>
        </tr>
        <tr>
          <td class="foot" style="padding:16px 6px 0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
            ${name}<br>
            <span style="color:${MUTED};">Sent with Volteira</span>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>
</body>
</html>`;
}
