/**
 * The contractor's own CSLB license, as the owner records it (compliance
 * CSLB-001-002). An unlicensed contractor cannot recover payment for the work
 * (B&P 7031), so Volteira warns when the license may have lapsed and asks for
 * an acknowledgement before billing while it is recorded as lapsed.
 *
 * The owner checks the license on CSLB's public lookup and enters what it
 * says; Volteira does not look it up itself yet.
 *
 * Import-free, so the rule is tested directly.
 */

export const LICENSE_STATUSES = ["active", "inactive", "expired", "suspended", "revoked"] as const;
export type LicenseStatus = (typeof LICENSE_STATUSES)[number];

/** How long a check on CSLB's lookup counts as current. */
export const LICENSE_RECHECK_DAYS = 90;
/** How long an owner's acknowledgement of a lapsed license lets billing go on. */
export const LICENSE_ACK_DAYS = 7;

export const CSLB_LOOKUP_URL = "https://www.cslb.ca.gov/OnlineServices/CheckLicenseII/CheckLicense.aspx";

export type LicenseFacts = {
  number: string;
  status: string | null;
  /** "2027-06-30" */
  expiresOn: string | null;
  /** The day the owner last checked it on CSLB's lookup. */
  verifiedOn: string | null;
  /** When the owner last acknowledged a lapsed license, as an ISO instant. */
  acknowledgedAt: string | null;
};

export type LicenseWarning =
  | { level: "none" }
  /** Not checked recently, or not recorded: a reminder, nothing stops. */
  | { level: "stale"; message: string }
  /** Recorded as not active or past its expiry: billing waits for an acknowledgement. */
  | { level: "lapsed"; message: string; acknowledged: boolean };

const DAY = 86_400_000;

function daysBetween(fromIsoDate: string, today: string): number {
  return Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${fromIsoDate}T00:00:00Z`)) / DAY);
}

/** `today` is the business's own date, "2026-11-28". */
export function licenseWarning(license: LicenseFacts, today: string, now: Date): LicenseWarning {
  const status = (license.status ?? "").toLowerCase();
  const expired = Boolean(license.expiresOn) && license.expiresOn! < today;
  if (license.number.trim() && ((status && status !== "active") || expired)) {
    const acknowledged = Boolean(license.acknowledgedAt) && now.getTime() - Date.parse(license.acknowledgedAt!) < LICENSE_ACK_DAYS * DAY;
    return {
      level: "lapsed",
      acknowledged,
      message: expired
        ? `Your contractor license is recorded as expired on ${license.expiresOn}. California does not let an unlicensed contractor collect payment for the work.`
        : `Your contractor license is recorded as ${status}. California does not let an unlicensed contractor collect payment for the work.`,
    };
  }
  if (!license.number.trim() || !status || !license.expiresOn) {
    return { level: "stale", message: "Add your license status and expiry date from CSLB's license lookup." };
  }
  if (!license.verifiedOn || daysBetween(license.verifiedOn, today) > LICENSE_RECHECK_DAYS) {
    return { level: "stale", message: `Check your license on CSLB's lookup: it hasn't been checked in the last ${LICENSE_RECHECK_DAYS} days.` };
  }
  return { level: "none" };
}

/** Why billing must wait, or "" when it may go: only a lapsed license nobody has acknowledged this week. */
export function licenseBillingRefusal(warning: LicenseWarning): string {
  if (warning.level !== "lapsed" || warning.acknowledged) return "";
  return `${warning.message} Check it, update Settings → Business, or acknowledge it there to keep billing.`;
}
