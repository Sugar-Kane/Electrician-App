import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Boxes,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  Mail,
  MapPin,
  Navigation,
  Phone,
  Route,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import {
  buildAppleDirectionsUrl,
  buildGoogleDirectionsUrl,
  jobNeedsMaterialStop,
  pilotJobs,
  serviceBase,
} from "@/lib/pilot-data";
import { JobContract } from "@/components/job-contract";
import { JobControls } from "@/components/job-controls";
import { getJob, getJobContracts, getJobControls } from "@/lib/job-data";

export function generateStaticParams() {
  return pilotJobs.map((job) => ({ jobId: job.id }));
}

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { job } = await getJob(jobId);
  if (!job) notFound();

  // Null for the signed-out demo view, where there is nothing real to edit.
  const [controls, contracts] = await Promise.all([
    getJobControls(jobId),
    getJobContracts(jobId),
  ]);

  const fullAddress = `${job.address}, ${job.city}`;
  const needsStop = jobNeedsMaterialStop(job);
  const googleMapsUrl = buildGoogleDirectionsUrl([serviceBase.address, fullAddress]);
  const appleMapsUrl = buildAppleDirectionsUrl(fullAddress);

  return (
    <FieldPageShell title={job.customer} eyebrow={`Job #${job.id}`} description={`${job.workType} · ${job.dateLabel}, ${job.time}–${job.endTime}`}>
      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <div className="space-y-4">
          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-ink-faint">Customer and property</p><h2 className="mt-1 text-xl font-semibold">{job.contactName}</h2></div><span className="grid h-11 w-11 place-items-center rounded-control bg-[#163044] font-semibold">{job.technicianInitials}</span></div>
            <div className="mt-4 space-y-2">
              <a href={`tel:${job.phone.replace(/[^\d+]/g, "")}`} className="tap-row flex min-h-12 items-center gap-3 rounded-control border border-line px-3"><Phone className="h-5 w-5 text-brand" aria-hidden /><span className="flex-1 text-sm">{job.phone}</span><ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden /></a>
              <a href={`mailto:${job.email}`} className="tap-row flex min-h-12 items-center gap-3 rounded-control border border-line px-3"><Mail className="h-5 w-5 text-brand" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm">{job.email}</span><ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden /></a>
              <a href={appleMapsUrl} target="_blank" rel="noreferrer" className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line px-3"><MapPin className="h-5 w-5 shrink-0 text-brand" aria-hidden /><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{job.address}</span><span className="block text-xs text-ink-muted">{job.city}</span></span><ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden /></a>
            </div>
          </section>

          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-control bg-white/5 text-brand"><ClipboardList className="h-5 w-5" aria-hidden /></span><div><p className="text-xs text-ink-faint">Type of work</p><h2 className="text-lg font-semibold">{job.workType}</h2></div></div>
            <p className="mt-4 text-sm leading-6 text-ink-muted">{job.summary}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-control bg-white/[0.03] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">Access</p><p className="mt-1.5 text-xs leading-5 text-ink-muted">{job.accessNotes}</p></div>
              <div className="rounded-control bg-white/[0.03] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-ink-faint">Service notes</p><p className="mt-1.5 text-xs leading-5 text-ink-muted">{job.serviceNotes}</p></div>
            </div>
          </section>

          <section id="documents" className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center justify-between gap-3"><div><p className="text-xs text-ink-faint">Job files</p><h2 className="mt-1 text-lg font-semibold">Documentation</h2></div><Link href={`/files?job=${job.id}`} className="tap-target inline-flex min-h-11 items-center gap-1 text-xs font-semibold text-brand">Open files <ChevronRight className="h-4 w-4" aria-hidden /></Link></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {job.documents.map((document) => (
                <Link key={document.name} href={`/jobs/${job.id}?document=${encodeURIComponent(document.name)}#documents`} className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line px-3 active:bg-white/5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-white/5"><FileText className="h-4 w-4 text-ink-muted" aria-hidden /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{document.name}</span><span className="block text-[10px] text-ink-faint">{document.kind} · {document.updated}</span></span>
                  <ChevronRight className="h-4 w-4 text-ink-faint" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center justify-between"><div><p className="text-xs text-ink-faint">Assigned</p><h2 className="mt-1 text-lg font-semibold">{job.technician}</h2></div><UserRound className="h-5 w-5 text-brand" aria-hidden /></div>
            <div className="mt-4 space-y-2 text-sm"><p className="flex items-center gap-2 text-ink-muted"><CalendarDays className="h-4 w-4 text-ink-faint" aria-hidden />{job.dateLabel}, {job.time}</p><p className="flex items-center gap-2 text-ink-muted"><ShieldAlert className="h-4 w-4 text-ink-faint" aria-hidden />{job.status}</p></div>
          </section>

          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center justify-between"><div><p className="text-xs text-ink-faint">Required for this job</p><h2 className="mt-1 text-lg font-semibold">Materials</h2></div><Boxes className="h-5 w-5 text-brand" aria-hidden /></div>
            <div className="mt-4 space-y-3">
              {job.materials.map((material) => {
                const shortage = Math.max(0, material.quantity - material.truckStock);
                return <div key={material.name} className="rounded-control bg-white/[0.03] p-3"><div className="flex justify-between gap-3"><p className="text-sm font-semibold">{material.name}</p><p className="shrink-0 text-sm text-brand">{material.quantity} {material.unit}</p></div><p className="mt-1 text-[11px] text-ink-muted">Truck: {material.truckStock} · {shortage > 0 ? `Buy ${shortage}` : "Ready on truck"}</p></div>;
              })}
              {job.materials.length === 0 ? <p className="text-sm text-ink-muted">No materials are required for this estimate visit.</p> : null}
            </div>
            <Link href={`/materials?job=${job.id}`} className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"><Boxes className="h-4 w-4" aria-hidden /> Find materials and prices</Link>
            {needsStop ? <p className="mt-2 text-center text-[10px] text-amber-300">A supply stop will be included when the route is built.</p> : null}
          </section>

          <section className="rounded-panel border border-line bg-surface p-5">
            <p className="text-xs text-ink-faint">Navigation</p><h2 className="mt-1 text-lg font-semibold">Build the route first</h2>
            <Link href={`/route?job=${job.id}`} className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"><Route className="h-4 w-4" aria-hidden /> Optimize route</Link>
            <div className="mt-2 grid grid-cols-2 gap-2"><a href={googleMapsUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-center gap-1.5 rounded-control border border-line text-xs"><Navigation className="h-4 w-4" aria-hidden /> Google</a><a href={appleMapsUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-center gap-1.5 rounded-control border border-line text-xs"><Navigation className="h-4 w-4" aria-hidden /> Apple</a></div>
          </section>
        </div>
      </div>

      {controls ? (
        <div className="mt-4">
          <JobControls
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

      {controls ? (
        <div className="mt-4">
          <JobContract jobNumber={controls.jobNumber} contracts={contracts} />
        </div>
      ) : null}
    </FieldPageShell>
  );
}
