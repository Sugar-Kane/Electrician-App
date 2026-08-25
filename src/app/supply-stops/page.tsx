import type { Metadata } from "next";

import { FieldPageShell } from "@/components/field-page-shell";
import { SupplyStopList } from "@/components/supply-stop-list";
import { getSupplyStops } from "@/lib/job-data";

export const metadata: Metadata = { title: "Supply stops | Volteira" };
export const dynamic = "force-dynamic";

/**
 * Where this business buys things.
 *
 * The route builder has offered two stops since it was written — a Lowe's and a
 * Home Depot in Santa Maria, hardcoded with their store numbers. Right for the
 * pilot business, wrong for everybody else, and wrong for the pilot business
 * too the moment they want their own storage unit on the route, which is where
 * most of an electrician's stock actually lives.
 */
export default async function SupplyStopsPage() {
  const stops = await getSupplyStops();

  return (
    <FieldPageShell
      title="Supply stops"
      eyebrow="Where you pick things up"
      description="Anywhere you stop on the way to a job — a supply house, a big-box store, your own storage. The route puts the one you pick before the first job that needs it."
      backHref="/materials"
    >
      <SupplyStopList stops={stops} />
    </FieldPageShell>
  );
}
