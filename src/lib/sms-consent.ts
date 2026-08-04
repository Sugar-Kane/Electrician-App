/**
 * Single source of truth for the text-message consent disclosure.
 *
 * A2P 10DLC review compares three things and rejects the campaign when they
 * disagree: the wording next to the checkbox the customer ticks, the consent
 * record the business retains, and the "How you join" section of the published
 * SMS terms the reviewer reads. All three read from here.
 *
 * The disclosure must carry, in the customer's view at the moment of consent:
 * the business name, what the messages are about, that frequency varies, that
 * message and data rates may apply, how to stop, how to get help, and that
 * consent is not a condition of purchase.
 */

/** Bump when the wording changes, so stored consents stay attributable. */
export const SMS_CONSENT_VERSION = "2026-08-04";

export function smsConsentDisclosure(businessName: string): string {
  return (
    `I agree to receive text messages from ${businessName} about this appointment, ` +
    "including confirmations, arrival windows, technician en-route notices, and " +
    "replies about my service. Message frequency varies. Message and data rates " +
    "may apply. Reply STOP to opt out or HELP for help. Consent is not a condition " +
    "of purchase, and declining does not affect this booking."
  );
}

/** Stored alongside the intake so the wording can be evidenced later. */
export function smsConsentRecord(businessName: string): string {
  return `[v${SMS_CONSENT_VERSION}] ${smsConsentDisclosure(businessName)}`;
}
