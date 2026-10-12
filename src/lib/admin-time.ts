/**
 * Times in the support console, in the business's own time zone.
 *
 * The console used to print times with the server's clock, which is UTC, while
 * the app printed the same moment in the business's zone. The same booking then
 * read five hours apart on the two screens, which looks like corrupted data and
 * is not. Every console time now names its zone, and the UTC moment is kept for
 * the tooltip, so the two screens can be lined up exactly.
 *
 * Import-free so it runs anywhere.
 */

export const FALLBACK_TIME_ZONE = "America/Los_Angeles";

function validZone(timeZone: string): string {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return timeZone;
  } catch {
    return FALLBACK_TIME_ZONE;
  }
}

export type AdminTime = {
  /** "Oct 12, 2:05 PM CDT", or "Oct 12, 2025, 2:05 PM CDT" outside this year. */
  label: string;
  /** "2026-10-12 19:05 UTC", for lining up with logs and the provider's records. */
  utc: string;
};

export function adminTime(
  iso: string,
  timeZone: string,
  options: { dateOnly?: boolean; now?: Date } = {},
): AdminTime | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;

  const zone = validZone(timeZone || FALLBACK_TIME_ZONE);
  const now = options.now ?? new Date();
  const sameYear =
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(date) ===
    new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(now);

  const label = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" as const }),
    ...(options.dateOnly ? {} : { hour: "numeric" as const, minute: "2-digit" as const, timeZoneName: "short" as const }),
  }).format(date);

  const utc = `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
  return { label, utc };
}

/** The zone's short name right now, e.g. "CDT", for headers that name it once. */
export function zoneAbbreviation(timeZone: string, at: Date = new Date()): string {
  const zone = validZone(timeZone || FALLBACK_TIME_ZONE);
  const part = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" })
    .formatToParts(at)
    .find((entry) => entry.type === "timeZoneName");
  return part?.value ?? zone;
}
