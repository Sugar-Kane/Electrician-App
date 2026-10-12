import Link from "next/link";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty } from "@/components/admin-ui";
import { listRecentBookings, type OrganizationDetail } from "@/lib/admin-console";
import { maskContacts, maskEmail, maskPhone } from "@/lib/admin-mask";

/** Recent bookings, and whether anybody was told about each. */
export async function BookingsTab({ organization, revealed }: { organization: OrganizationDetail; revealed: boolean }) {
  const bookings = await listRecentBookings(organization.id, 30);
  const zone = organization.timeZone;
  const base = `/admin/organizations/${organization.id}`;

  return (
    <Card title="Recent bookings" aside={`${bookings.length} shown`}>
      {bookings.length === 0 ? (
        <Empty>No bookings.</Empty>
      ) : (
        <ul className="space-y-3">
          {bookings.map((booking) => (
            <li key={booking.id} id={`booking-${booking.id}`} className="scroll-mt-28 rounded-control border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="text-sm font-semibold">
                  {booking.contactName || "No name"} · {booking.status}
                </p>
                <p className="text-xs text-ink-faint">
                  <AdminTime iso={booking.createdAt} timeZone={zone} />
                </p>
              </div>
              <p className="mt-1 text-sm text-ink-muted">
                {revealed ? booking.phone : maskPhone(booking.phone)}
                {booking.email ? ` · ${revealed ? booking.email : maskEmail(booking.email)}` : ""}
              </p>
              <p className="mt-1 text-sm text-ink-muted">{revealed ? booking.description : maskContacts(booking.description)}</p>
              <p className="mt-1 text-xs text-ink-faint">
                {booking.windowStart ? (
                  <>
                    Window <AdminTime iso={booking.windowStart} timeZone={zone} />
                  </>
                ) : (
                  "No window"
                )}{" "}
                · {booking.intakeAnswerCount} intake answers
                {booking.jobId ? " · became a job" : ""}
              </p>

              {booking.notifications.length > 0 ? (
                <ul className="mt-3 space-y-1">
                  {booking.notifications.map((attempt, index) => (
                    <li
                      key={`${booking.id}-${index}`}
                      className={`rounded-chip px-3 py-2 text-xs ${attempt.ok ? "bg-positive-bg text-positive" : "bg-critical-bg text-critical"}`}
                    >
                      <span className="font-semibold">
                        {attempt.audience} {attempt.channel}
                      </span>
                      {attempt.to ? ` → ${revealed ? attempt.to : maskContacts(attempt.to)}` : ""} ·{" "}
                      {attempt.ok ? "sent" : "failed"}
                      {attempt.detail ? ` — ${revealed ? attempt.detail : maskContacts(attempt.detail)}` : ""}
                      {attempt.at ? (
                        <>
                          {" · "}
                          <AdminTime iso={attempt.at} timeZone={zone} />
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-xs text-ink-faint">
                  No notification record — this booking predates the tracking, or nothing was attempted.
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs text-ink-faint">
        Looking for a job a booking became? <Link href={`${base}?tab=jobs`} className="font-semibold text-brand">Jobs</Link>
      </p>
    </Card>
  );
}
