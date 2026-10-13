import { createHash, randomBytes } from "node:crypto";

/**
 * Requests sent in from a business's own website.
 *
 * The site posts each request with a key the owner made in Settings. The key
 * decides which business the request belongs to, so it is the whole of the
 * security here: it is long, random, shown once, and only its hash is kept.
 *
 * Import-free apart from `node:crypto`, so every rule can be read in a test.
 */

export const WEBSITE_KEY_PREFIX = "vwk_";

/** 32 random bytes: a key nobody guesses and nobody needs to remember. */
export function newWebsiteKey(): string {
  return `${WEBSITE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

export function hashWebsiteKey(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

/** The key from an `Authorization: Bearer …` header, or null when there isn't a well-formed one. */
export function bearerWebsiteKey(header: string | null): string | null {
  const match = /^Bearer\s+(vwk_[A-Za-z0-9_-]{43})\s*$/.exec(header ?? "");
  return match ? match[1]! : null;
}

export type WebsiteRequest = {
  /** The website's own id for this request; the idempotency key. */
  reference: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  postalCode: string;
  service: string;
  serviceName: string;
  description: string;
  preferredTimes: string;
  contactMethod: "phone" | "email" | "text";
  /** True only when the customer ticked the box beside `smsDisclosure`. */
  smsConsent: boolean;
  /** The words beside that box, exactly as the customer saw them. */
  smsDisclosure: string;
  /** Which site sent it, for the consent record. */
  site: string;
};

function field(record: Record<string, unknown>, key: string, max: number): string {
  const value = record[key];
  return typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "";
}

/** Check a request body, field by field, the way the website's form does. */
export function parseWebsiteRequest(body: unknown): { ok: true; request: WebsiteRequest } | { ok: false; error: string } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, error: "Send the request as a JSON object." };
  const record = body as Record<string, unknown>;

  const reference = field(record, "reference", 100);
  if (!/^[A-Za-z0-9-]{8,100}$/.test(reference)) return { ok: false, error: "A request reference is required." };
  const firstName = field(record, "firstName", 80);
  if (!firstName) return { ok: false, error: "A first name is required." };
  const phone = field(record, "phone", 30);
  if (phone.replace(/\D/g, "").length < 10) return { ok: false, error: "A phone number with at least ten digits is required." };
  const email = field(record, "email", 254);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { ok: false, error: "That email address doesn't look right." };

  const method = field(record, "contactMethod", 10);
  const contactMethod = method === "text" || method === "email" ? method : "phone";
  const smsConsent = record.smsConsent === true;
  const smsDisclosure = field(record, "smsDisclosure", 1000);
  // Consent without the words it was given against is not evidence of anything.
  if (smsConsent && !smsDisclosure) return { ok: false, error: "Text consent needs the wording the customer agreed to." };

  return {
    ok: true,
    request: {
      reference,
      firstName,
      lastName: field(record, "lastName", 80),
      phone,
      email,
      address: field(record, "address", 200),
      city: field(record, "city", 80),
      postalCode: field(record, "postalCode", 10),
      service: field(record, "service", 80),
      serviceName: field(record, "serviceName", 120),
      description: field(record, "description", 2000),
      preferredTimes: field(record, "preferredTimes", 300),
      contactMethod,
      smsConsent,
      smsDisclosure: smsConsent ? smsDisclosure : "",
      site: field(record, "site", 120),
    },
  };
}

/** What `website_intake` said about consent for this request. */
export type IntakeConsent = "recorded" | "existing" | "opted_out" | "none" | "unchanged";

export type TextDecision =
  | { send: true }
  | { send: false; reason: "duplicate" | "no_consent" | "opted_out" | "texting_not_set_up" };

/**
 * Whether the assistant may text this customer about their website request.
 *
 * Only once per request, only with consent the customer gave on the form or
 * earlier, never after a STOP, and only when the business can send texts at
 * all. `consentActiveNow` is read again after the request is saved, so a STOP
 * that lands in between is still honoured.
 */
export function websiteTextDecision(input: {
  duplicate: boolean;
  consent: IntakeConsent;
  consentActiveNow: boolean;
  textingConfigured: boolean;
}): TextDecision {
  if (input.duplicate || input.consent === "unchanged") return { send: false, reason: "duplicate" };
  if (input.consent === "none") return { send: false, reason: "no_consent" };
  if (input.consent === "opted_out" || !input.consentActiveNow) return { send: false, reason: "opted_out" };
  if (!input.textingConfigured) return { send: false, reason: "texting_not_set_up" };
  return { send: true };
}

/** The website request as one customer message, which is how the assistant reads a conversation. */
export function websiteIntakeTurn(request: {
  contactName: string;
  serviceName: string;
  description: string;
  address: string;
  city: string;
  postalCode: string;
  preferredTimes: string;
  email: string;
}): string {
  const where = [request.address, [request.city, request.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [
    "[Sent from the request form on the business's website]",
    request.contactName ? `My name is ${request.contactName}.` : "",
    request.serviceName ? `I need help with: ${request.serviceName}.` : "",
    request.description ? `What's happening: ${request.description}` : "",
    where ? `The address is ${where}.` : "",
    request.preferredTimes ? `Good times for me: ${request.preferredTimes}.` : "",
    request.email ? `My email is ${request.email}.` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

/**
 * The first text, which has to say why it is arriving.
 *
 * Somebody who filled in a form a minute ago and gets a text from a number they
 * don't know needs the business's name and the reason in the first line, or it
 * reads as spam and gets a STOP.
 */
export function websiteOpener(input: {
  businessName: string;
  assistantName: string;
  firstName: string;
  reply: string;
}): string {
  const name = displayFirstName(input.firstName);
  const hello = name ? `Hi ${name}, ` : "Hi, ";
  return `${hello}this is ${input.assistantName} from ${input.businessName}. I just received your request on our website and would like to get you scheduled with an electrician. ${withoutGreeting(input.reply)}`;
}

/** "adam" as typed into a form reads as "Adam"; a name typed with capitals is left alone. */
function displayFirstName(name: string): string {
  const trimmed = name.trim();
  return trimmed === trimmed.toLowerCase() ? trimmed.charAt(0).toUpperCase() + trimmed.slice(1) : trimmed;
}

/**
 * The assistant's reply without its own "Hi Adam —": the opener has already
 * said hello, and a text that greets twice reads like two systems talking.
 */
function withoutGreeting(reply: string): string {
  const trimmed = reply.trim();
  const stripped = trimmed.replace(/^(hi|hello|hey|hola)\b[^.!?,\u2014\u2013-]{0,40}[,!.\u2014\u2013-]+\s*/i, "");
  if (!stripped || stripped === trimmed) return trimmed;
  return stripped.charAt(0).toUpperCase() + stripped.slice(1);
}

export type CallDecision = { call: true } | { call: false; reason: "duplicate" | "not_asked" | "calling_not_set_up" };

/**
 * Whether the assistant rings someone back about their website request.
 *
 * Only when they chose a phone call on the form, which together with the form's
 * required "I agree to be contacted about this service request" is them asking
 * to be called about it. A resent request rings nobody a second time.
 */
export function websiteCallDecision(input: {
  duplicate: boolean;
  contactMethod: string;
  callingConfigured: boolean;
}): CallDecision {
  if (input.duplicate) return { call: false, reason: "duplicate" };
  if (input.contactMethod !== "phone") return { call: false, reason: "not_asked" };
  if (!input.callingConfigured) return { call: false, reason: "calling_not_set_up" };
  return { call: true };
}

/** Left on a voicemail: who called, why, and the number to ring back. */
export function websiteCallbackVoicemail(input: { businessName: string; firstName: string; businessPhone: string }): string {
  const name = displayFirstName(input.firstName);
  const digits = input.businessPhone.replace(/\D/g, "").slice(-10);
  // Read out in groups, the way a person would say it, not as one long number.
  const say = (part: string) => part.split("").join(" ");
  const spokenNumber = digits.length === 10 ? `${say(digits.slice(0, 3))}, ${say(digits.slice(3, 6))}, ${say(digits.slice(6))}` : "";
  return [
    `Hi${name ? ` ${name}` : ""}, this is Maya with ${input.businessName}, calling about the service request you sent through our website.`,
    spokenNumber
      ? `Please call us back at ${spokenNumber} and we'll get you scheduled. Again, that's ${spokenNumber}.`
      : "Please call us back and we'll get you scheduled.",
    "Thank you.",
  ].join(" ");
}

/**
 * The voicemail as Twilio plays it, then hangs up. A neural voice, the closest
 * Twilio has to a person; the message is the business's own words, escaped so
 * a name typed on the form can't add instructions.
 */
export function websiteCallbackVoicemailTwiml(message: string): string {
  const escaped = message
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
  return `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Joanna-Neural">${escaped}</Say><Hangup /></Response>`;
}

/**
 * Said when the assistant itself is unavailable, so the customer still hears
 * from the business: the same introduction, and the first question a visit
 * needs answered. Their reply goes to the assistant like any other text.
 */
export function websiteOpenerFallback(input: {
  businessName: string;
  assistantName: string;
  firstName: string;
  firstQuestion: string;
}): string {
  const question = input.firstQuestion.trim();
  return websiteOpener({
    businessName: input.businessName,
    assistantName: input.assistantName,
    firstName: input.firstName,
    reply: `To start, ${question.charAt(0).toLowerCase()}${question.slice(1)} Reply STOP to opt out.`,
  });
}

export type CallbackOutcome = "completed" | "voicemail" | "no_answer" | "busy" | "failed";

/**
 * How a call back ended, from Twilio's final status. Null while it is still
 * going: only an ended call is claimed and acted on.
 */
export function callbackOutcomeFor(input: { callStatus: string; answeredBy: string }): CallbackOutcome | null {
  switch (input.callStatus) {
    case "completed":
      return /^(machine|fax)/.test(input.answeredBy) ? "voicemail" : "completed";
    case "no-answer":
      return "no_answer";
    case "busy":
      return "busy";
    case "failed":
    case "canceled":
      return "failed";
    default:
      return null;
  }
}

/**
 * Whether the owner needs to pick it up after the call: anybody not reached,
 * and anybody reached who ended the call with nothing booked and no callback
 * asked for. A booking or a callback request tells the owner itself.
 */
export function callbackNeedsOwner(
  outcome: CallbackOutcome,
  request: { booked: boolean; handedOff: boolean },
): "voicemail" | "no_answer" | "busy" | "failed" | "not_booked" | null {
  if (outcome === "completed") return request.booked || request.handedOff ? null : "not_booked";
  return outcome;
}
