import { adminTime } from "@/lib/admin-time";

/**
 * One moment in the support console, in the business's zone, named.
 *
 * Hover (or long-press) gives the UTC time, which is what Twilio, Stripe and
 * the server logs print.
 */
export function AdminTime({
  iso,
  timeZone,
  dateOnly,
  empty = "—",
}: {
  iso: string;
  timeZone: string;
  dateOnly?: boolean;
  empty?: string;
}) {
  const time = adminTime(iso, timeZone, { dateOnly });
  if (!time) return <>{empty}</>;
  return (
    <time dateTime={iso} title={time.utc}>
      {time.label}
    </time>
  );
}
