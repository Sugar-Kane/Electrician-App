/**
 * When support may send a failed text again, or correct the number it went to.
 *
 * The facts come from `admin_message_facts`, read in one moment. The rules are
 * here so they can be tested, and they run twice: once to decide what the page
 * offers, and again at the moment of sending, against freshly read facts, with
 * the database checking the parts that matter most a third time.
 *
 * The rule of thumb is the blueprint's: a retry must not send something the
 * customer has asked not to get, something that already reached them, or
 * something no longer true.
 *
 * Import-free apart from the app's own rules, so it can be tested alone.
 */

import { failureReason } from "../message-errors.ts";
import { consentIsActive, evaluateQuietHours } from "../messaging-rules.ts";
import { toE164 } from "../phone-format.ts";

export type TextFacts = {
  /** The business the console page is for. */
  organizationId: string;
  message: {
    id: string;
    organizationId: string;
    direction: string;
    status: string;
    errorCode: string;
    body: string;
    createdAt: string;
    updatedAt: string;
    providerMessageId: string;
  };
  customer: { id: string; name: string; phone: string } | null;
  consent: { optedInAt: string | null; optedOutAt: string | null };
  job: { jobNumber: string; status: string } | null;
  messaging: { serviceSid: string; quietStart: string; quietEnd: string; timezone: string };
  /** Texts sent in the same conversation after this one. */
  laterSends: { status: string; sameBody: boolean }[];
  /** A correction of this customer's number finished after this text failed. */
  recipientFixedAt: string;
  /** Earlier support operations on this text, newest first. */
  operations: { tool: string; state: string }[];
};

const FAILED = new Set(["failed", "undelivered"]);
const WENT_OUT = new Set(["queued", "sending", "sent", "delivered"]);
const CLOSED_JOB = new Set(["canceled", "completed"]);

/**
 * Why this text cannot be sent again right now, or null when it can.
 *
 * In the order support would fix things: whose text it is, whether it failed
 * at all, whether it already went, whether the failure can be fixed by
 * sending, then the customer, the business and the clock.
 */
export function retryRefusal(facts: TextFacts, now: Date = new Date()): string | null {
  const { message } = facts;
  if (message.organizationId !== facts.organizationId) return "This text belongs to another business.";
  if (message.direction !== "outbound") return "Only a text the business sent can be sent again.";
  if (!FAILED.has(message.status)) return "This text didn't fail, so there is nothing to send again.";

  // Support's own retries first: their new text is also a later send with the
  // same words, and saying which retry it was is more use than "duplicate".
  const retries = facts.operations.filter((operation) => operation.tool === "retry_text");
  if (retries.some((operation) => operation.state === "unknown" || operation.state === "attempted"))
    return "An earlier retry's outcome isn't known yet. Check its delivery before trying again.";
  if (retries.some((operation) => operation.state === "accepted" || operation.state === "verified"))
    return "It has already been sent again once. Check that text instead of sending a third.";

  if (facts.laterSends.some((later) => later.sameBody && WENT_OUT.has(later.status)))
    return "The same words have been sent since. Sending them again would be a duplicate.";

  const reason = failureReason(message.errorCode);
  const numberProblem = reason.kind === "invalid_number" || reason.kind === "not_mobile";
  if (!reason.retryable && !(numberProblem && facts.recipientFixedAt))
    return numberProblem
      ? `${reason.words}. Sending it again would fail the same way: correct the customer's number first.`
      : `${reason.words}. Sending it again would fail the same way.`;

  if (!facts.customer || !toE164(facts.customer.phone)) return "The customer has no number that can be texted.";
  if (!consentIsActive(facts.consent))
    return facts.consent.optedOutAt
      ? "The customer replied STOP. They have to opt back in themselves."
      : "The customer hasn't agreed to texts from this business.";
  if (!facts.messaging.serviceSid) return "Texting isn't set up for this business.";

  if (facts.job && CLOSED_JOB.has(facts.job.status))
    return `Job #${facts.job.jobNumber} is ${facts.job.status === "canceled" ? "cancelled" : "completed"}, so this text may no longer be true.`;

  const quiet = evaluateQuietHours(facts.messaging.quietStart, facts.messaging.quietEnd, facts.messaging.timezone, now);
  if (quiet.currentlyQuiet)
    return `It's quiet hours for this business until ${quiet.end.slice(0, 5)}. Try again after that.`;

  return null;
}

/**
 * Everything a retry preview depends on, as one string.
 *
 * The page carries it; the send compares it with freshly read facts and stops
 * if anything moved — a delivery report arriving, the number changing, an
 * opt-out — rather than sending what the admin did not see.
 */
export function textFingerprint(facts: TextFacts): string {
  return [
    facts.message.id,
    facts.message.status,
    facts.message.updatedAt,
    facts.customer?.phone ?? "",
    facts.consent.optedInAt ?? "",
    facts.consent.optedOutAt ?? "",
    facts.job?.status ?? "",
    facts.laterSends.length,
    facts.operations.length,
    facts.recipientFixedAt,
  ].join("|");
}

/**
 * The claim for one attempt at retrying one text.
 *
 * Counted from the attempts already made, so two admins pressing Send at the
 * same moment build the same key and the database lets only one through.
 */
export function retryKey(messageId: string, operations: { tool: string }[]): string {
  return `retry_text:${messageId}:${operations.filter((operation) => operation.tool === "retry_text").length}`;
}

/** What a send's answer means: taken, refused, or not known. */
export function sendOutcome(result: { ok: boolean; errorCode?: string }): "accepted" | "failed" | "unknown" {
  if (result.ok) return "accepted";
  // No answer at all is not a refusal: the text may have gone.
  return result.errorCode === "network_error" ? "unknown" : "failed";
}

/** A number typed to replace the customer's, checked before anything is shown. */
export function recipientCorrection(
  current: string,
  typed: string,
): { ok: true; number: string } | { ok: false; refusal: string } {
  const number = toE164(typed);
  if (!number)
    return { ok: false, refusal: "That isn't a number that can be texted. Use 10 digits, or + and the country code." };
  if (number === toE164(current)) return { ok: false, refusal: "That's already the number on file." };
  return { ok: true, number };
}
