/**
 * What the MCP call log may keep.
 *
 * Every ChatGPT/Claude and voice-booking tool call is logged so a failure can
 * be traced. The log used to keep each call's arguments whole and up to 4,000
 * characters of what the tool said back: customers' names, phone numbers,
 * addresses, emails, the words of their texts, and links that work on their own
 * (signing, invoice and booking links). Any member of the business could read
 * it, and it was never deleted (audit finding MT-06).
 *
 * Now it keeps what tracing needs — which tool, which ids, numbers, statuses,
 * whether it failed — and nothing that identifies a person or opens a link.
 * Fields that carry people's details are replaced by "[redacted]" whatever they
 * hold; everything else that looks like an email, a phone number, a link or a
 * card number is masked inside the text. The database deletes rows after 90
 * days and shows them only to owners and admins.
 *
 * Import-free, so what is kept is tested on its own.
 */

/** Fields whose values are personal details or secrets, whatever they look like. */
const SENSITIVE_KEY =
  /(phone|mobile|email|e_mail|name|address|street|line_1|line_2|city|postal|zip|message|body|text|note|description|summary|reason|comment|signature|token|secret|password|key|url|link|card|account|iban|routing|ssn|birth|dob|transcript|recording|caller|contact|customer_details|details)/i;

/** Ids, numbers and states that tracing needs, kept even though they match a word above. */
const KEPT_KEY = /(^|_)(id|ids|number|status|kind|type|scope|method|count|cents|amount|quantity|hours|confirmed|channel|send|action)$/i;

const MAX_STRING = 200;
const MAX_ITEMS = 20;
const MAX_DEPTH = 4;
export const MAX_LOGGED_RESULT = 1000;

const UUID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;

/** Emails, phone numbers, links and card-like numbers in free text, masked. */
export function scrubLogText(text: string, limit = MAX_LOGGED_RESULT): string {
  // Record ids are kept (they are what tracing follows) but are made of digit
  // runs a card or phone pattern would eat, so they are set aside first. Ids
  // inside links go with the link.
  const ids: string[] = [];
  const withoutLinks = (text ?? "").replace(/https?:\/\/[^\s)"'<>]+/gi, "[link]");
  const masked = withoutLinks
    .replace(UUID_PATTERN, (id) => `\u0000${ids.push(id) - 1}\u0000`)
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    // Stripe object ids, client secrets and API keys: never kept in a log.
    .replace(/\b(?:seti|pi|pm|cus|cs|acct|ch|re|sk|rk|whsec)_[A-Za-z0-9_]{6,}\b/g, "[stripe]")
    // Card-like runs of 13–19 digits, with or without spaces and dashes.
    .replace(/\b(?:\d[ -]?){13,19}\b/g, "[number]")
    // Phone numbers: optional +1, area code, then 7 digits, in the usual shapes.
    .replace(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, "[phone]")
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => ids[Number(index)] ?? "");
  return masked.length > limit ? `${masked.slice(0, Math.max(0, limit - 1))}…` : masked;
}

function redactValue(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return scrubLogText(value, MAX_STRING);
  if (depth >= MAX_DEPTH) return "[nested]";
  if (Array.isArray(value)) return value.slice(0, MAX_ITEMS).map((entry) => redactValue(entry, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>).slice(0, 50)) {
      out[key] = SENSITIVE_KEY.test(key) && !KEPT_KEY.test(key) ? "[redacted]" : redactValue(entry, depth + 1);
    }
    return out;
  }
  return "[unloggable]";
}

/** A tool call's arguments, as the log keeps them. */
export function redactLogArguments(args: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!args || typeof args !== "object") return {};
  return redactValue(args, 0) as Record<string, unknown>;
}
