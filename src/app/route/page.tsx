import { FieldPageShell } from "@/components/field-page-shell";
import { RouteOptimizer } from "@/components/route-optimizer";
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

export default async function RoutePage({ searchParams }: { searchParams: Promise<RouteSearchParams> }) {
  const query = await searchParams;
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

  return (
    <FieldPageShell title="Route builder" eyebrow="Dispatch optimization" description="Volteira builds and locks the stop order first. Navigation opens only after you approve the route." active="More">
      <RouteOptimizer focusJobId={job || undefined} initialSupplier={initialSupplier} initialSupplyStore={initialSupplyStore} />
    </FieldPageShell>
  );
}
