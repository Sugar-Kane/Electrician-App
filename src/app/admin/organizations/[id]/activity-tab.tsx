import Link from "next/link";
import { TriangleAlert } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty } from "@/components/admin-ui";
import { listOrgActivity, type OrganizationDetail } from "@/lib/admin-console";
import { buildTimeline } from "@/lib/activity-timeline";
import { maskContacts } from "@/lib/admin-mask";
import { todayInZone } from "@/lib/calendar";

/**
 * The business's own history, worded as the app words it on a job, plus a
 * link to what support has done there.
 */
export async function ActivityTab({ organization, revealed }: { organization: OrganizationDetail; revealed: boolean }) {
  const zone = organization.timeZone;
  const rows = await listOrgActivity(organization.id);
  const days = buildTimeline(rows, zone, todayInZone(zone));
  const base = `/admin/organizations/${organization.id}`;

  return (
    <Card
      title="What happened"
      aside={
        <Link href={`/admin/audit?business=${organization.id}`} className="font-semibold text-brand">
          What support did here
        </Link>
      }
    >
      {days.length === 0 ? (
        <Empty>Nothing recorded yet.</Empty>
      ) : (
        <div className="space-y-5">
          {days.map((day) => (
            <section key={day.date}>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-ink-faint">{day.label}</h3>
              <ul className="mt-2 space-y-2">
                {day.entries.map((entry) => (
                  <li
                    key={entry.id}
                    className={`rounded-control border p-3 ${entry.failed ? "border-critical/25 bg-critical-bg" : "border-line"}`}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="flex items-center gap-1.5 text-sm font-semibold">
                        {entry.failed ? <TriangleAlert className="h-4 w-4 shrink-0 text-critical" aria-hidden /> : null}
                        {entry.failed ? <span className="text-critical">Failed </span> : null}
                        {entry.title}
                      </p>
                      <p className="text-xs text-ink-faint">
                        <AdminTime iso={entry.at} timeZone={zone} />
                      </p>
                    </div>
                    {entry.detail ? (
                      <p className="mt-1 text-sm text-ink-muted">{revealed ? entry.detail : maskContacts(entry.detail)}</p>
                    ) : null}
                    {entry.jobId ? (
                      <Link href={`${base}/jobs/${entry.jobId}`} className="mt-1 inline-block text-xs font-semibold text-brand">
                        Job #{entry.jobId}
                      </Link>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </Card>
  );
}
