/**
 * Why a text failed, in words, and whether sending it again could help.
 *
 * Twilio reports a failure as a number. Support needs the sentence, and needs to
 * know which failures a retry cannot fix: a number that does not exist, a
 * landline, or a customer who replied STOP will fail the same way every time,
 * and retrying the last one would text somebody who asked not to be texted.
 *
 * Import-free so it can be used anywhere.
 */

export type FailureKind =
  | "invalid_number"
  | "not_mobile"
  | "opted_out"
  | "blocked"
  | "unreachable"
  | "carrier_filtered"
  | "unregistered"
  | "rate_limited"
  | "setup"
  | "unknown";

export type FailureReason = {
  kind: FailureKind;
  /** One plain sentence for the console. */
  words: string;
  /** Whether sending the same text again could succeed without changing anything. */
  retryable: boolean;
};

const BY_CODE: Record<string, FailureReason> = {
  "21211": { kind: "invalid_number", words: "Not a valid phone number", retryable: false },
  "30005": { kind: "invalid_number", words: "The carrier doesn't know this number", retryable: false },
  "21614": { kind: "not_mobile", words: "Not a mobile number", retryable: false },
  "30006": { kind: "not_mobile", words: "A landline, or a carrier that can't take texts", retryable: false },
  "21610": { kind: "opted_out", words: "The customer replied STOP", retryable: false },
  "30004": { kind: "blocked", words: "Blocked by the customer's phone", retryable: false },
  "30003": { kind: "unreachable", words: "Phone off or out of signal", retryable: true },
  "30007": { kind: "carrier_filtered", words: "Filtered by the carrier as spam", retryable: false },
  "30034": { kind: "unregistered", words: "Sending number not registered for texting (A2P 10DLC)", retryable: false },
  "30032": { kind: "unregistered", words: "Toll-free number not verified", retryable: false },
  "30024": { kind: "unregistered", words: "Sending number not set up with the carrier", retryable: false },
  "21408": { kind: "setup", words: "Texting to this region isn't turned on", retryable: false },
  "21606": { kind: "setup", words: "The sending number can't send texts", retryable: false },
  "30002": { kind: "setup", words: "The Twilio account is suspended", retryable: false },
  "20429": { kind: "rate_limited", words: "Too many sent at once", retryable: true },
  "14107": { kind: "rate_limited", words: "Too many sent at once", retryable: true },
  "30022": { kind: "rate_limited", words: "Too many sent at once", retryable: true },
  "30001": { kind: "rate_limited", words: "Twilio's queue was full", retryable: true },
  "30008": { kind: "unknown", words: "The carrier gave no reason", retryable: true },
  not_configured: { kind: "setup", words: "Texting isn't set up for this business", retryable: false },
  network_error: { kind: "unknown", words: "Couldn't reach Twilio", retryable: true },
};

export function failureReason(code: string | null | undefined): FailureReason {
  const key = (code ?? "").trim();
  return BY_CODE[key] ?? { kind: "unknown", words: key ? `Failed (code ${key})` : "Failed with no reason given", retryable: true };
}

/**
 * A text's delivery, in words, and how sure that is.
 *
 * "Accepted" is Twilio taking it; only a delivery report says the phone got
 * it. A text with neither is unknown, not delivered.
 */
export function deliveryState(message: {
  direction: string;
  status: string;
  errorCode: string;
  hasProviderRef: boolean;
}): { label: string; tone: "good" | "problem" | "waiting" | "neutral" } {
  if (message.direction !== "outbound") return { label: "Received", tone: "neutral" };
  if (message.status === "delivered") return { label: "Delivered", tone: "good" };
  if (message.status === "failed" || message.status === "undelivered")
    return { label: `Failed · ${failureReason(message.errorCode).words}`, tone: "problem" };
  if (message.hasProviderRef) return { label: "Accepted by Twilio · no delivery report", tone: "waiting" };
  return { label: "Not sent to Twilio", tone: "waiting" };
}
