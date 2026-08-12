import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  Mail,
  MapPin,
  Navigation,
  Phone,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { jobNeedsMaterialStop, pilotJobs } from "@/lib/pilot-data";
import { JobContract } from "@/components/job-contract";
import { JobControls } from "@/components/job-controls";
import { JobLinesPanel } from "@/components/job-lines-panel";
import { JobNotes } from "@/components/job-notes";
import { JobStatusStrip } from "@/components/job-status-strip";
import { StatusBadge } from "@/components/ui/status-badge";
import { getJob, getJobContracts, getJobControls } from "@/lib/job-data";
import { getJobLines, getStockOptions } from "@/lib/job-line-data";

export function generateStaticParams() {
  return pilotJobs.map((job) => ({ jobId: job.id }));
}

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { job } = await getJob(jobId);
  if (!job) notFound();

  // Null for the signed-out demo view, where there is nothing real to edit.
  const [controls, contracts, { lines, totals }, stock] = await Promise.all([
    getJobControls(jobId),
    getJobContracts(jobId),
    getJobLines(jobId),
    getStockOptions(),
  ]);

  const fullAddress = `${job.address}, ${job.city}`;
  const needsStop = jobNeedsMaterialStop(job);
  // Destination only, so the maps app starts from wherever the phone is. The
  // route-builder URL names the shop as the origin, which is right for planning
  // a day and wrong for a technician already standing somewhere else.
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`;

  return (
    <FieldPageShell
      title={job.customer}
      eyebrow={`Job #${job.id}`}
      backHref="/schedule"
    >
      {/*
        Ordered the way the work happens: who and where, how to get there and
        reach them, what state the job is in, what the customer said, what it
        needs, and what it is worth. The page used to open with a card about
        the customer record and reach the status control — the thing that
        changes hourly — collapsed and below the fold.
      */}
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-ink-muted">
              {job.dateLabel} · {job.time}–{job.endTime}
            </p>
            <h2 className="mt-1 text-xl font-semibold">{job.contactName}</h2>
            <p className="mt-1 text-sm capitalize text-ink-muted">
              {job.workType.replace(/_/g, " ")}
            </p>
          </div>
          <StatusBadge status={job.status} />
        </div>

        {fullAddress.trim() !== "," ? (
          <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {fullAddress}
          </p>
        ) : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noreferrer"
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand text-sm font-semibold text-on-brand"
          >
            <Navigation className="h-4 w-4" aria-hidden />
            Navigate
          </a>
          {job.phone ? (
            <a
              href={`tel:${job.phone.replace(/[^\d+]/g, "")}`}
              className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
            >
              <Phone className="h-4 w-4" aria-hidden />
              Call
            </a>
          ) : null}
          {job.phone ? (
            <a
              href={`sms:${job.phone.replace(/[^\d+]/g, "")}`}
              className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold"
            >
              <Mail className="h-4 w-4" aria-hidden />
              Text
            </a>
          ) : null}
        </div>
      </section>

      {controls ? (
        <div className="mt-3">
          <JobStatusStrip
            jobNumber={controls.jobNumber}
            status={controls.status}
            canceled={controls.canceled}
          />
        </div>
      ) : null}

      {job.summary || job.serviceNotes || job.accessNotes ? (
        <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">What the customer said</h2>
          {job.summary ? (
            <p className="mt-2 text-sm leading-6 text-ink-muted">{job.summary}</p>
          ) : null}
          {job.serviceNotes ? (
            <p className="mt-3 rounded-control bg-white/[0.03] p-3 text-sm leading-6 text-ink-muted">
              {job.serviceNotes}
            </p>
          ) : null}
          {job.accessNotes ? (
            <p className="mt-3 flex items-start gap-2 rounded-control bg-white/[0.03] p-3 text-sm leading-6 text-ink-muted">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
              {job.accessNotes}
            </p>
          ) : null}
        </section>
      ) : null}

      {controls ? (
        <>
          <JobLinesPanel
            jobNumber={controls.jobNumber}
            lines={lines}
            totals={totals}
            stock={stock}
          />
          <JobNotes
            // Remounted when the saved notes change, so the textarea's initial
            // value follows the server rather than holding what was there when
            // the component first mounted.
            key={controls.technicianNotes}
            jobNumber={controls.jobNumber}
            notes={controls.technicianNotes}
          />
        </>
      ) : (
        // The signed-out demo view has no job to add lines to, and a form that
        // silently fails is worse than a sentence saying why it is not there.
        <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Materials</h2>
            <Link
              href={`/materials?job=${job.id}`}
              className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand"
            >
              {needsStop ? "Buy what is short" : "Check stock"}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          {job.materials.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Nothing listed for this job yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {job.materials.map((material) => (
                <li key={material.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{material.name}</span>
                  <span className="shrink-0 text-ink-muted">
                    {material.quantity} {material.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold">Files</h2>
          <Link
            href={`/files?job=${job.id}`}
            className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand"
          >
            Open files
            <ChevronRight className="h-4 w-4" aria-hidden />
          </Link>
        </div>
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
          <UserRound className="h-4 w-4 shrink-0" aria-hidden />
          {job.technician}
        </p>
      </section>

      {controls ? (
        <div className="mt-3">
          <JobContract jobNumber={controls.jobNumber} contracts={contracts} />
        </div>
      ) : null}

      {controls ? (
        <div className="mt-3">
          <JobControls
            // Remounted when the status changes, so the form's uncontrolled
            // select picks up the new defaultValue. Without this, changing
            // status on the strip and then saving an arrival window submits the
            // stale status and silently reverts it.
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
        </div>
      ) : null}
    </FieldPageShell>
  );
}
