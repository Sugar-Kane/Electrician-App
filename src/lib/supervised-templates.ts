/**
 * Approved wording for automatic customer messages.
 *
 * A message built from one of these may be approved by an owner or an admin;
 * anything else written for the occasion (by ChatGPT, say) needs the owner.
 * Values are plain text, trimmed and stripped of control characters, so a
 * customer name or an event's text can't add lines or links of its own.
 * Import-free, so it can be tested directly.
 */

export type TemplateKey = "invoice_overdue" | "estimate_accepted" | "job_complete_thanks" | "lead_follow_up";

type Template = { label: string; channel: "sms" | "email" | "internal"; body: string; required: string[] };

export const SUPERVISED_TEMPLATES: Record<TemplateKey, Template> = {
  invoice_overdue: {
    label: "Overdue invoice reminder",
    channel: "sms",
    body: "Hi {first_name}, this is {business}. A friendly reminder that {invoice} for {amount} was due {due_date}. You can pay here: {pay_link}",
    required: ["first_name", "business", "invoice", "amount", "due_date", "pay_link"],
  },
  estimate_accepted: {
    label: "Thanks for accepting the estimate",
    channel: "sms",
    body: "Hi {first_name}, thank you for accepting the estimate for job #{job}. {business} will be in touch shortly to book the work.",
    required: ["first_name", "job", "business"],
  },
  job_complete_thanks: {
    label: "Thanks after the work",
    channel: "sms",
    body: "Hi {first_name}, thank you for choosing {business}. Job #{job} is complete. Reply here if anything needs another look.",
    required: ["first_name", "business", "job"],
  },
  lead_follow_up: {
    label: "Follow up a new website request",
    channel: "internal",
    body: "Follow up with {name} about their website request{service}. They asked to be reached by {contact_method}.",
    required: ["name", "service", "contact_method"],
  },
};

export function isTemplateKey(value: unknown): value is TemplateKey {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(SUPERVISED_TEMPLATES, value);
}

function clean(value: string): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
}

/**
 * The template filled in, or why it can't be: a required value missing or a
 * placeholder left unfilled. Never returns half a message.
 */
export function renderTemplate(
  key: TemplateKey,
  values: Record<string, string>,
): { ok: true; text: string } | { ok: false; reason: string } {
  const template = SUPERVISED_TEMPLATES[key];
  const missing = template.required.filter((name) => !(name in values) || (name !== "service" && !clean(values[name] ?? "")));
  if (missing.length > 0) return { ok: false, reason: `Missing ${missing.join(", ")}.` };
  const text = template.body.replace(/\{([a-z_]+)\}/g, (_, name: string) => clean(values[name] ?? ""));
  if (/\{[a-z_]+\}/.test(text)) return { ok: false, reason: "A placeholder was left unfilled." };
  return { ok: true, text };
}
