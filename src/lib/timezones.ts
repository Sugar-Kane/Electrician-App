/**
 * The timezones a business can be set to.
 *
 * Deliberately a short list of US zones rather than the full IANA database:
 * this is a field-service app for one crew, and a dispatcher choosing between
 * 600 identifiers is a worse experience than choosing between eight. Values are
 * IANA identifiers, so widening the list later needs no data migration.
 */

export const DEFAULT_TIMEZONE = "America/Los_Angeles";

export const TIMEZONE_OPTIONS = [
  { value: "America/Los_Angeles", label: "Pacific Time" },
  { value: "America/Denver", label: "Mountain Time" },
  { value: "America/Phoenix", label: "Arizona Time (no daylight saving)" },
  { value: "America/Chicago", label: "Central Time" },
  { value: "America/New_York", label: "Eastern Time" },
  { value: "America/Anchorage", label: "Alaska Time" },
  { value: "Pacific/Honolulu", label: "Hawaii Time" },
  { value: "America/Puerto_Rico", label: "Atlantic Time" },
] as const;

export function isSupportedTimezone(value: string): boolean {
  return TIMEZONE_OPTIONS.some((option) => option.value === value);
}

export function timezoneLabel(value: string): string {
  return TIMEZONE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

/** "3:42 PM PDT" — what the business's clock reads right now. */
export function currentTimeIn(value: string, now: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat("en-US", {
      timeZone: value,
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(now);
  } catch {
    return "";
  }
}
