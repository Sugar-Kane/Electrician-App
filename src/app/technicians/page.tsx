import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, Phone, UserRound } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getTechnicianWorkloads } from "@/lib/job-data";

export const metadata: Metadata = { title: "Crew | Volteira" };

const STATUS_STYLES: Record<string, string> = {
  "In progress": "bg-info-bg text-info",
  Scheduled: "bg-caution-bg text-caution",
  Completed: "bg-positive-bg text-positive",
  Canceled: "bg-critical-bg text-critical",
  Pending: "bg-white/5 text-ink-muted",
};

/**
 * Who is on the crew, and what each of them is doing today.
 *
 * The "Techs working" tile used to open the route builder, which answers a
 * different question — how to drive between stops, not who is out and where.
 */
export default async function TechniciansPage() {
  const { technicians } = await getTechnicianWorkloads();
  const working = technicians.filter((technician) => technician.jobs.length > 0).length;

  return (
    <FieldPageShell
      title="Crew"
      eyebrow="Who is working"
      description={
        technicians.length === 0
          ? "Nobody has been added to the crew yet."
          : `${working} of ${technicians.length} out on a job today.`
      }
    >
      <div className="space-y-3">
        {technicians.map((technician) => (
          <section
            key={technician.id}
            className="rounded-panel border border-line bg-surface p-5"
          >
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-brand/10 text-sm font-bold text-brand">
                {technician.initials || <UserRound className="h-5 w-5" aria-hidden />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{technician.name}</p>
                <p className="text-xs text-ink-muted">
                  {technician.isActive ? "Active" : "Not active"} ·{" "}
                  {technician.jobs.length === 0
                    ? "nothing scheduled today"
                    : `${technician.jobs.length} job${technician.jobs.length === 1 ? "" : "s"} today`}
                </p>
              </div>
              {technician.phone ? (
                <a
                  href={`tel:${technician.phone.replace(/[^\d+]/g, "")}`}
                  className="tap-target grid h-11 w-11 shrink-0 place-items-center rounded-chip border border-line text-brand"
                  aria-label={`Call ${technician.name}`}
                >
                  <Phone className="h-5 w-5" aria-hidden />
                </a>
              ) : null}
            </div>

            {technician.jobs.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {technician.jobs.map((job) => (
                  <li key={job.id}>
                    <Link
                      href={`/jobs/${job.id}`}
                      className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line px-4"
                    >
                      <time className="shrink-0 text-xs font-semibold text-info">{job.time}</time>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{job.customer}</span>
                        <span className="block truncate text-xs text-ink-muted">{job.city}</span>
                      </span>
                      <span
                        className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-semibold ${STATUS_STYLES[job.status] ?? ""}`}
                      >
                        {job.status}
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}

        {technicians.length === 0 ? (
          <p className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">
            No crew members yet.
          </p>
        ) : null}
      </div>
    </FieldPageShell>
  );
}
