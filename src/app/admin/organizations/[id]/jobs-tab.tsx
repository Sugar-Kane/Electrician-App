import Link from "next/link";
import { ChevronRight } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Empty, Pill } from "@/components/admin-ui";
import { listOrgJobs, type OrganizationDetail } from "@/lib/admin-console";
import { lateness, lateLabel } from "@/lib/follow-ups";
import { JOB_STAGE_LABELS, jobStage, jobStatusLabel } from "@/lib/job-stage";
import { kindOfWork } from "@/lib/new-job-input";

/** Every job, newest first, each opening its full trace. */
export async function JobsTab({ organization, customerId }: { organization: OrganizationDetail; customerId: string }) {
  const jobs = await listOrgJobs(organization.id, customerId);
  const zone = organization.timeZone;
  const now = new Date();
  const base = `/admin/organizations/${organization.id}`;

  return (
    <Card
      title={customerId && jobs[0] ? `Jobs for ${jobs[0].customerName}` : "Jobs"}
      aside={
        customerId ? (
          <Link href={`${base}?tab=jobs`} className="font-semibold text-brand">
            All jobs
          </Link>
        ) : (
          `${jobs.length} shown`
        )
      }
    >
      {jobs.length === 0 ? (
        <Empty>No jobs.</Empty>
      ) : (
        <ul className="space-y-2">
          {jobs.map((job) => {
            const kind = kindOfWork(job.category);
            const status = jobStatusLabel(job.status);
            const stage = jobStage({
              status,
              scheduled: Boolean(job.scheduledStart),
              kindOfWork: kind,
              agreement: job.agreementSent || job.agreementSigned ? { sent: job.agreementSent, signed: job.agreementSigned } : null,
            });
            const late = lateness({ stage: job.status, startsAt: job.scheduledStart, endsAt: job.scheduledEnd }, now);
            return (
              <li key={job.id}>
                <Link
                  href={`${base}/jobs/${job.number}`}
                  className="tap-row flex items-center gap-3 rounded-control border border-line bg-raised px-3 py-2.5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        #{job.number} · {job.customerName}
                      </span>
                      <span className="flex flex-wrap gap-1.5">
                        {late ? <Pill tone="problem">{lateLabel(late)}</Pill> : null}
                        {status === "Completed" && job.invoiceCount === 0 ? <Pill tone="problem">Not invoiced</Pill> : null}
                        <Pill>{JOB_STAGE_LABELS[stage]}</Pill>
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-ink-muted">
                      {kind}
                      {job.technician ? ` · ${job.technician}` : ""}
                      {job.city ? ` · ${job.city}` : ""}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      {job.scheduledStart ? <AdminTime iso={job.scheduledStart} timeZone={zone} /> : "No time yet"}
                    </span>
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
