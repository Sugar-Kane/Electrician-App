import "server-only";

import { currentContext } from "@/lib/request-context";
import { DEFAULT_TIMEZONE } from "@/lib/timezones";

/**
 * The signed-in user's business timezone.
 *
 * `organizations.timezone` is the one timezone that matters: quiet hours,
 * message timestamps, arrival windows and the schedule are all rendered in it.
 * Pages that need a date resolve it here rather than trusting the server's
 * clock, which in production is UTC.
 *
 * Falls back to the default for signed-out visitors and demo views.
 *
 * This used to be a third hand-rolled copy of "verify the session, then look up
 * the membership" — on /schedule that meant a whole extra round trip to the
 * auth server before the page could work out what day it was. `currentContext`
 * already has the answer and is memoised for the length of the request.
 */
export async function getOrganizationTimezone(): Promise<string> {
  try {
    const context = await currentContext();
    return context?.timeZone || DEFAULT_TIMEZONE;
  } catch {
    return DEFAULT_TIMEZONE;
  }
}
