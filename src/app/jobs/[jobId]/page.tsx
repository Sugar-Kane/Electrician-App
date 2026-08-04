import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Boxes,
  CalendarDays,
  ChevronRight,
  ClipboardList,
  FileText,
  Mail,
  Phone,
  Route,
  ShieldAlert,
  UserRound,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { JobAddressLink, JobDirectionsButtons } from "@/components/job-directions";
import {
  getPilotJob,
  jobNeedsMaterialStop,
  pilotJobs,
} from "@/lib/pilot-data";

export function generateStaticParams() {
  return pilotJobs.map((job) => ({ jobId: job.id }));
}

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const job = getPilotJob(jobId);
  if (!job) notFound();

  const fullAddress = `${job.address}, ${job.city}`;
  const needsStop = jobNeedsMaterialStop(job);

  return (
    <FieldPageShell title={job.customer} eyebrow={`Job #${job.id}`} description={`${job.workType} · ${job.dateLabel}, ${job.time}–${job.endTime}`} active="Jobs">
      <div className="grid gap-4 lg:grid-cols-[1.25fr_.75fr]">
        <div className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-500">Customer and property</p><h2 className="mt-1 text-xl font-semibold">{job.contactName}</h2></div><span className="grid h-11 w-11 place-items-center rounded-2xl bg-[#163044] font-semibold">{job.technicianInitials}</span></div>
            <div className="mt-4 space-y-2">
              <a href={`tel:${job.phone.replace(/[^\d+]/g, "")}`} className="tap-row flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 px-3"><Phone className="h-5 w-5 text-[#ffc21c]" aria-hidden /><span className="flex-1 text-sm">{job.phone}</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></a>
              <a href={`mailto:${job.email}`} className="tap-row flex min-h-12 items-center gap-3 rounded-2xl border border-white/10 px-3"><Mail className="h-5 w-5 text-[#ffc21c]" aria-hidden /><span className="min-w-0 flex-1 truncate text-sm">{job.email}</span><ChevronRight className="h-4 w-4 text-slate-500" aria-hidden /></a>
              <JobAddressLink address={job.address} city={job.city} />
            </div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-2xl bg-white/5 text-[#ffc21c]"><ClipboardList className="h-5 w-5" aria-hidden /></span><div><p className="text-xs text-slate-500">Type of work</p><h2 className="text-lg font-semibold">{job.workType}</h2></div></div>
            <p className="mt-4 text-sm leading-6 text-slate-300">{job.summary}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <div className="rounded-2xl bg-white/[0.03] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Access</p><p className="mt-1.5 text-xs leading-5 text-slate-300">{job.accessNotes}</p></div>
              <div className="rounded-2xl bg-white/[0.03] p-3"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-500">Service notes</p><p className="mt-1.5 text-xs leading-5 text-slate-300">{job.serviceNotes}</p></div>
            </div>
          </section>

          <section id="documents" className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <div className="flex items-center justify-between"><div><p className="text-xs text-slate-500">Job files</p><h2 className="mt-1 text-lg font-semibold">Documentation</h2></div><FileText className="h-5 w-5 text-[#ffc21c]" aria-hidden /></div>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {job.documents.map((document) => (
                <Link key={document.name} href={`/jobs/${job.id}?document=${encodeURIComponent(document.name)}#documents`} className="tap-row flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 px-3 active:bg-white/5">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5"><FileText className="h-4 w-4 text-slate-300" aria-hidden /></span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{document.name}</span><span className="block text-[10px] text-slate-500">{document.kind} · {document.updated}</span></span>
                  <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
                </Link>
              ))}
            </div>
          </section>
        </div>

        <div className="space-y-4">
          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <div className="flex items-center justify-between"><div><p className="text-xs text-slate-500">Assigned</p><h2 className="mt-1 text-lg font-semibold">{job.technician}</h2></div><UserRound className="h-5 w-5 text-[#ffc21c]" aria-hidden /></div>
            <div className="mt-4 space-y-2 text-sm"><p className="flex items-center gap-2 text-slate-300"><CalendarDays className="h-4 w-4 text-slate-500" aria-hidden />{job.dateLabel}, {job.time}</p><p className="flex items-center gap-2 text-slate-300"><ShieldAlert className="h-4 w-4 text-slate-500" aria-hidden />{job.status}</p></div>
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <div className="flex items-center justify-between"><div><p className="text-xs text-slate-500">Required for this job</p><h2 className="mt-1 text-lg font-semibold">Materials</h2></div><Boxes className="h-5 w-5 text-[#ffc21c]" aria-hidden /></div>
            <div className="mt-4 space-y-3">
              {job.materials.map((material) => {
                const shortage = Math.max(0, material.quantity - material.truckStock);
                return <div key={material.name} className="rounded-2xl bg-white/[0.03] p-3"><div className="flex justify-between gap-3"><p className="text-sm font-semibold">{material.name}</p><p className="shrink-0 text-sm text-[#ffc21c]">{material.quantity} {material.unit}</p></div><p className="mt-1 text-[11px] text-slate-400">Truck: {material.truckStock} · {shortage > 0 ? `Buy ${shortage}` : "Ready on truck"}</p></div>;
              })}
              {job.materials.length === 0 ? <p className="text-sm text-slate-400">No materials are required for this estimate visit.</p> : null}
            </div>
            <Link href={`/materials?job=${job.id}`} className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><Boxes className="h-4 w-4" aria-hidden /> Find materials and prices</Link>
            {needsStop ? <p className="mt-2 text-center text-[10px] text-amber-300">A supply stop will be included when the route is built.</p> : null}
          </section>

          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <p className="text-xs text-slate-500">Navigation</p><h2 className="mt-1 text-lg font-semibold">Build the route first</h2>
            <Link href={`/route?job=${job.id}`} className="tap-target mt-4 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><Route className="h-4 w-4" aria-hidden /> Optimize route</Link>
            <JobDirectionsButtons destination={fullAddress} />
          </section>
        </div>
      </div>
    </FieldPageShell>
  );
}
