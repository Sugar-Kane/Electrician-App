import { notFound } from "next/navigation";

import { FieldPageShell } from "@/components/field-page-shell";
import { JobControls } from "@/components/job-controls";
import { getJob, getJobControls } from "@/lib/job-data";
import { pilotJobs } from "@/lib/pilot-data";

/**
 * Moving a job, and calling it off.
 *
 * Both used to live inline on the job page, between the technician's notes and
 * the bottom of the screen: two datetime pickers, a status dropdown, a
 * notification checkbox and a permanent offer to cancel the visit. Together
 * they were about half the page, on every job, forever — for two things that
 * happen once a fortnight and never while holding a torch.
 *
 * They are a page now, reached from the ••• menu. The field workflow is what is
 * left behind.
 */

export function generateStaticParams() {
  return pilotJobs.map((job) => ({ jobId: job.id }));
}

export default async function JobSettingsPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { job } = await getJob(jobId);
  if (!job) notFound();

  const controls = await getJobControls(jobId);

  return (
    <FieldPageShell
      title="Job settings"
      eyebrow={`Job #${job.id}`}
      description={`${job.contactName || job.customer} · ${job.dateLabel}`}
      backHref={`/jobs/${job.id}`}
    >
      {controls ? (
        <JobControls
          // Remounted when the status changes, so the form's uncontrolled
          // select picks up the new defaultValue. Without this, advancing the
          // job on the field screen and then saving an arrival window here
          // submits the stale status and silently reverts it.
          key={controls.status}
          jobNumber={controls.jobNumber}
          status={controls.status}
          startLocal={controls.startLocal}
          endLocal={controls.endLocal}
          canceled={controls.canceled}
          cancellationReason={controls.cancellationReason}
          customerPhone={controls.customerPhone}
          customerEmail={controls.customerEmail}
        />
      ) : (
        <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
          <h2 className="font-semibold">Nothing to edit here</h2>
          <p className="mt-2 text-sm leading-6 text-ink-muted">
            This is the demo workspace. Sign in to a business to move a job or call one off.
          </p>
        </section>
      )}
    </FieldPageShell>
  );
}
