/**
 * Template rendering and the rules about when an automatic message may go out.
 *
 * Import-free so it can be tested directly, like messaging-rules.
 */

export const TEMPLATE_TRIGGERS = [
  "job_awaiting_payment",
  "job_confirmed",
  "job_reminder",
  "job_en_route",
  "job_arrived",
  "job_completed",
  "job_rescheduled",
  "job_canceled",
  "estimate_sent",
  "invoice_sent",
  "invoice_overdue",
  "review_request",
] as const;

export type TemplateTrigger = (typeof TEMPLATE_TRIGGERS)[number];

export type TemplateVariables = {
  customer_first_name?: string;
  business_name?: string;
  business_phone?: string;
  arrival_window?: string;
  job_number?: string;
  technician_name?: string;
};

export const TEMPLATE_VARIABLE_NAMES = [
  "customer_first_name",
  "business_name",
  "business_phone",
  "arrival_window",
  "job_number",
  "technician_name",
] as const;

/**
 * Messages a customer is waiting on in real time. These go out during quiet
 * hours; the rest wait.
 *
 * Suppressing "your technician is on the way" because it is 07:50 would be
 * worse for the customer than the quiet-hours rule is trying to protect
 * against — they are about to have someone knock on their door.
 */
const TIME_CRITICAL_TRIGGERS = new Set<string>([
  "job_confirmed",
  "job_en_route",
  "job_arrived",
  "job_canceled",
  "job_rescheduled",
]);

export function triggerIgnoresQuietHours(trigger: string): boolean {
  return TIME_CRITICAL_TRIGGERS.has(trigger);
}

/**
 * Substitute {{placeholders}}.
 *
 * An unknown or empty placeholder renders as nothing rather than as literal
 * braces: a customer seeing "Hi {{customer_first_name}}" is worse than a
 * slightly clipped greeting, and it is the kind of thing that reaches a carrier
 * as a complaint.
 */
export function renderTemplate(body: string, variables: TemplateVariables): string {
  return body
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (_match, name: string) => {
      const value = variables[name.toLowerCase() as keyof TemplateVariables];
      return typeof value === "string" ? value : "";
    })
    // Substitution can leave doubled spaces or a space before punctuation.
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+([,.!?])/g, "$1")
    .trim();
}

export type AutomaticSendDecision =
  | { send: true; body: string }
  | { send: false; reason: string };

/**
 * Whether an automatic message should go out, and what it would say.
 *
 * Consent is the caller's to check against the ledger — this decides the rest,
 * so the ordering of the checks can be tested without a database.
 */
export function decideAutomaticSend(input: {
  trigger: string;
  template: { body: string; isActive: boolean } | null;
  variables: TemplateVariables;
  currentlyQuiet: boolean;
}): AutomaticSendDecision {
  if (!input.template) return { send: false, reason: "No template for this event." };
  if (!input.template.isActive) return { send: false, reason: "Template is switched off." };

  if (input.currentlyQuiet && !triggerIgnoresQuietHours(input.trigger)) {
    return { send: false, reason: "Quiet hours, and this message can wait." };
  }

  const body = renderTemplate(input.template.body, input.variables);
  if (body.length < 1) return { send: false, reason: "Template rendered empty." };
  if (body.length > 1600) return { send: false, reason: "Rendered message is too long to send." };

  return { send: true, body };
}
