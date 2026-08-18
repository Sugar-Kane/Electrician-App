import type { Metadata } from "next";
import Link from "next/link";
import { UserRoundPlus } from "lucide-react";

import { AddSelfElectrician } from "@/components/add-self-electrician";
import { BusinessAvailability } from "@/components/business-availability";
import { ElectricianCard } from "@/components/electrician-card";
import { FieldPageShell } from "@/components/field-page-shell";
import { getTechnicianWorkloads } from "@/lib/job-data";

export const metadata: Metadata = { title: "Electricians | Volteira" };

/**
 * Who is on the crew, who is working, and when.
 *
 * "Team" was the wrong word for a page that is read at seven in the morning to
 * find out who is out today. It is a list of electricians, so it says so.
 *
 * Everything here changes what customers are offered when they book online, not
 * just what this screen shows — turning somebody off, narrowing their hours, or
 * booking them out removes them from the availability the booking page counts.
 * That is the reason it is all in one place rather than split between a roster
 * and a settings screen.
 */
export default async function ElectriciansPage() {
  const {
    technicians,
    canManage,
    selfIsElectrician,
    businessBlackouts,
    businessHours,
    businessDateHours,
    timeZone,
  } = await getTechnicianWorkloads();

  const working = technicians.filter((electrician) => electrician.isActive).length;
  const outToday = technicians.filter((electrician) => electrician.jobs.length > 0).length;

  return (
    <FieldPageShell
      title="Electricians"
      eyebrow="Who is working"
      description={
        technicians.length === 0
          ? "Nobody has been added to the crew yet."
          : `${working} of ${technicians.length} working · ${outToday} out on a job today.`
      }
    >
      <div className="mb-3 flex justify-end">
        <Link
          href="/settings/team"
          className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
        >
          <UserRoundPlus className="h-4 w-4" aria-hidden />
          Invite someone
        </Link>
      </div>

      <div className="space-y-3">
        {canManage && !selfIsElectrician ? <AddSelfElectrician /> : null}

        {canManage ? (
          <BusinessAvailability
            hours={businessHours}
            dateHours={businessDateHours}
            closures={businessBlackouts}
            timeZone={timeZone}
          />
        ) : null}

        {technicians.map((electrician) => (
          <ElectricianCard
            key={electrician.id}
            electrician={electrician}
            canManage={canManage}
            businessHours={businessHours}
            businessDateHours={businessDateHours}
            timeZone={timeZone}
          />
        ))}

        {technicians.length === 0 && !canManage ? (
          <p className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">
            No electricians yet.
          </p>
        ) : null}
      </div>
    </FieldPageShell>
  );
}
