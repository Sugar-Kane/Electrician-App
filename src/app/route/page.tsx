import { FieldPageShell } from "@/components/field-page-shell";
import { RouteBuilder } from "@/components/route-builder";
import { todayInZone } from "@/lib/calendar";
import { getJobs, getSupplyStops, placeTodaysStops } from "@/lib/job-data";
import { getOrganizationTimezone } from "@/lib/organization-timezone";
import type { SupplierId, SupplyStore } from "@/lib/pilot-data";

type RouteSearchParams = {
  job?: string | string[];
  supplier?: string | string[];
  storeName?: string | string[];
  storeAddress?: string | string[];
  storeNumber?: string | string[];
};

function cleanValue(value: string | string[] | undefined, maximumLength: number) {
  const first = Array.isArray(value) ? value[0] : value;
  return first?.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, maximumLength) ?? "";
}

// The route is built around today, so it must not be served from a cache built
// on a previous day.
export const dynamic = "force-dynamic";

export default async function RoutePage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const [query, timeZone, { jobs }, stops] = await Promise.all([
    searchParams,
    getOrganizationTimezone(),
    getJobs(),
    getSupplyStops(),
  ]);

  // Addresses arrive from phone calls with no coordinates. Placing them here,
  // once, is what puts the day on a map at all — and what is returned is the
  // ones that could not be placed, so the page can say so rather than quietly
  // drawing a shorter route than the day actually has.
  const geocoded = await placeTodaysStops();
  const job = cleanValue(query.job, 40);
  const supplier = cleanValue(query.supplier, 24);
  const initialSupplier: SupplierId = supplier === "home-depot" ? "home-depot" : "lowes";
  const storeName = cleanValue(query.storeName, 160);
  const storeAddress = cleanValue(query.storeAddress, 240);
  const storeNumber = cleanValue(query.storeNumber, 40);
  const initialSupplyStore: SupplyStore | undefined = storeAddress ? {
    id: `confirmed-${initialSupplier}-${storeNumber || "store"}`,
    supplier: initialSupplier,
    name: storeName || (initialSupplier === "lowes" ? "Lowe’s pickup" : "Home Depot pickup"),
    shortName: initialSupplier === "lowes" ? "Lowe’s" : "Home Depot",
    address: storeAddress,
    storeNumber: storeNumber || undefined,
  } : undefined;

  /*
   * The business's own stop wins over the pilot's.
   *
   * The two hardcoded stores — a Lowe's and a Home Depot in Santa Maria — were
   * right for the pilot business and forty miles wrong for anyone else, and
   * wrong for the pilot business too the moment they want their own storage
   * unit on the route. A business that has said where it buys things gets that;
   * one that has not still gets the old pair, because a route with no supply
   * stop at all would be a worse answer than a nearby guess.
   *
   * `supplier` is carried over from the query rather than stored on the stop:
   * the builder compares the two to decide whether to fall back, and a storage
   * unit is not a Lowe's or a Home Depot.
   */
  const chosen = stops.find((stop) => stop.isDefault) ?? stops[0];
  const ownStore: SupplyStore | undefined = chosen
    ? {
        id: chosen.id,
        supplier: initialSupplier,
        name: chosen.name,
        shortName: chosen.name,
        address: [chosen.address, chosen.city, chosen.state].filter(Boolean).join(", "),
        coordinates: chosen.coordinates ?? undefined,
      }
    : undefined;

  return (
    <FieldPageShell title="Route builder" eyebrow="Dispatch optimization" description="The order is built on the map from today's real stops. Move or drop any of them, then lock it and navigate.">
      <RouteBuilder
        jobs={jobs}
        today={todayInZone(timeZone)}
        apiKey={process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? ""}
        unplaced={geocoded.unplaced}
        focusJobId={job || undefined}
        initialSupplier={initialSupplier}
        initialSupplyStore={initialSupplyStore ?? ownStore}
      />
    </FieldPageShell>
  );
}
