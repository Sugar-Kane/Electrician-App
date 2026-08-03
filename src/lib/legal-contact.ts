// Single source of truth for the business details shown on the public legal
// pages. Carriers verify these during A2P 10DLC campaign review, and the
// values must match the brand registered with The Campaign Registry.
//
// ⚠️ REPLACE EVERY PLACEHOLDER BELOW BEFORE SUBMITTING THE A2P CAMPAIGN.
// A reviewer who finds a placeholder here will reject the campaign.

export const legalContact = {
  businessName: "Pacific Plains Electric",
  supportPhone: "REPLACE_WITH_SUPPORT_PHONE",
  supportEmail: "REPLACE_WITH_SUPPORT_EMAIL",
  mailingAddress: "REPLACE_WITH_STREET_ADDRESS, Santa Maria, CA 93454",
  // The SMS program name registered with the carriers.
  programName: "Pacific Plains Electric Service Notifications",
  // Must be an honest upper bound — carriers compare it to real traffic.
  messageFrequency: "up to 8 messages per service appointment",
  lastUpdated: "August 3, 2026",
} as const;

/** True when any placeholder is still unreplaced — used to warn in non-production. */
export function hasUnreplacedPlaceholders(): boolean {
  return Object.values(legalContact).some(
    (v) => typeof v === "string" && v.includes("REPLACE_WITH_"),
  );
}
