/**
 * The look every email from a business on Volteira shares: a navy frame with
 * the business's name over a yellow rule, the message on a white card, yellow
 * buttons, and a quiet footer.
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
const MUTED = "#8aa0b0";

function escape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** A yellow button, for the one thing the email asks the reader to do. */
export function emailButton(href: string, label: string): string {
  return `<a href="${escape(href)}" style="display:inline-block;background:${YELLOW};color:${NAVY};font-weight:700;padding:13px 24px;border-radius:12px;text-decoration:none;font-size:16px">${escape(label)}</a>`;
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

export function brandedEmail(input: {
  /** The message itself: paragraphs, tables, links. */
  html: string;
  /** Shown in the header; the business sending it. */
  businessName: string;
  /** The line inbox previews show under the subject. */
  preheader?: string;
}): string {
  if (isWholeDocument(input.html)) return input.html;
  const name = escape(input.businessName.trim() || "Volteira");
  const preheader = escape((input.preheader ?? "").replace(/\s+/g, " ").trim().slice(0, 140));
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light">
<title>${name}</title>
<style>
  .card a { color: #9a6b00; }
  .card p { margin: 0 0 14px; }
  .card table td { vertical-align: top; }
  @media (max-width: 600px) { .card { padding: 22px 18px !important; } }
</style>
</head>
<body style="margin:0;padding:0;background:${NAVY};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:${NAVY}">${preheader}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${NAVY};">
  <tr>
    <td align="center" style="padding:28px 12px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;">
        <tr>
          <td style="padding:0 6px 14px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
            <div style="font-size:20px;font-weight:800;letter-spacing:-0.01em;color:#ffffff;">${name}</div>
            <div style="margin-top:10px;height:4px;width:56px;border-radius:4px;background:${YELLOW};line-height:4px;font-size:0;">&nbsp;</div>
          </td>
        </tr>
        <tr>
          <td class="card" style="background:#ffffff;border-radius:18px;padding:28px 28px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:${INK};">
            ${input.html}
          </td>
        </tr>
        <tr>
          <td style="padding:18px 6px 0;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:${MUTED};">
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
