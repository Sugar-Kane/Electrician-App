import Link from "next/link";
import { Boxes, CheckCircle2, ChevronRight, PackageSearch, Search, Settings2, Store, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { MaterialSourcingWorkflow } from "@/components/material-sourcing-workflow";
import { pilotHomeDepotStore, pilotLowesStore, serviceBase } from "@/lib/pilot-data";
import { getInventory, getJobs } from "@/lib/job-data";
import { describeCoverage, matchMaterials } from "@/lib/inventory-match";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ job?: string; query?: string }> }) {
  const { job: jobId, query = "" } = await searchParams;

  // The business's own jobs, not the pilot fixtures. Materials have no table
  // yet, so a real job carries none and this page correctly shows nothing to
  // buy — which is honest, where a list of invented parts was not.
  const [{ jobs }, stock] = await Promise.all([getJobs(), getInventory()]);
  const selectedJob = jobId ? jobs.find((job) => job.id === jobId) : undefined;
  const allMaterials = (selectedJob ? selectedJob.materials : jobs.flatMap((job) => job.materials)).filter((material, index, materials) => materials.findIndex((candidate) => candidate.name === material.name) === index);
  const normalized = query.trim().toLowerCase();
  const filtered = normalized ? allMaterials.filter((material) => material.name.toLowerCase().includes(normalized)) : allMaterials;

  // What the business actually has, rather than the fixture's own truckStock
  // number. A materials list that ignores the van sends somebody to Lowe's for
  // a breaker they have four of.
  const matched = matchMaterials(
    filtered.map((material) => ({ name: material.name, quantity: material.quantity, unit: material.unit })),
    stock.map((item) => ({
      id: item.id,
      name: item.name,
      quantity: item.quantity,
      unit: item.unit,
      partNumber: item.partNumber,
      location: item.location,
    })),
  );
  const materials = filtered.map((material, index) => ({
    ...material,
    truckStock: matched[index]?.inStock ?? 0,
  }));
  const coverage = describeCoverage(matched);
  const nearAddress = selectedJob ? `${selectedJob.address}, ${selectedJob.city}` : serviceBase.address;

  return (
    <FieldPageShell title="Material sourcing" eyebrow={selectedJob ? `Job #${selectedJob.id}` : "Inventory and suppliers"} description="Review what is already on the truck, identify shortages, and check live retailer results before adding a supply stop.">
      <div className="grid gap-4 lg:grid-cols-[1fr_.72fr]">
        <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
          <form action="/materials" className="flex gap-2"><input type="hidden" name="job" value={jobId ?? ""} /><label className="flex min-h-12 flex-1 items-center gap-2 rounded-control border border-line bg-raised px-4"><Search className="h-4 w-4 text-ink-faint" aria-hidden /><span className="sr-only">Search required materials</span><input name="query" defaultValue={query} placeholder="Search materials…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint" /></label><button className="tap-target grid h-12 w-12 place-items-center rounded-control bg-brand text-on-brand" aria-label="Search materials"><PackageSearch className="h-5 w-5" aria-hidden /></button></form>
          <p className="mt-4 rounded-control border border-line bg-white/[0.025] px-4 py-3 text-xs leading-5 text-ink-muted">
            {coverage}{" "}
            <Link href="/inventory" className="font-semibold text-brand">Manage stock</Link>
          </p>
          <div className="mt-5"><MaterialSourcingWorkflow materials={materials} jobReference={jobId} nearAddress={nearAddress} /></div>
        </section>

        <div className="space-y-4">
          {selectedJob ? <Link href={`/jobs/${selectedJob.id}`} className="tap-row flex min-h-14 items-center justify-between rounded-panel border border-line bg-surface px-4"><span><span className="block text-xs text-ink-faint">Return to job</span><span className="block text-sm font-semibold">{selectedJob.customer}</span></span><ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden /></Link> : null}
          <section className="rounded-panel border border-amber-400/25 bg-amber-400/[0.06] p-5">
            <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden /><div><p className="font-semibold text-amber-200">Retailer approval required for in-app data</p><p className="mt-2 text-sm leading-6 text-ink-muted">The prices above are pilot estimates, not retailer claims. The buttons open each retailer’s current results. Lowe’s store-level data requires Product Discovery approval; Home Depot offers a daily affiliate product feed, while live local inventory remains on its retailer page.</p><Link href="/settings/integrations" className="tap-target mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand"><Settings2 className="h-4 w-4" aria-hidden /> Manage supplier connections</Link></div></div>
          </section>
          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center gap-3"><Store className="h-5 w-5 text-brand" aria-hidden /><div><p className="text-xs text-ink-faint">Choose a supply stop</p><h2 className="font-semibold">Route after product review</h2></div></div>
            <ul className="mt-4 space-y-2 text-xs text-ink-muted"><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />Added only when truck stock is short</li><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />Placed before the first job needing materials</li></ul>
            <div className="mt-4 space-y-2">
              <Link href={selectedJob ? `/route?job=${selectedJob.id}&supplier=lowes` : "/route?supplier=lowes"} className="tap-target flex min-h-13 items-center justify-between rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"><span className="flex items-center gap-2"><Boxes className="h-4 w-4" aria-hidden /> Route through Lowe’s</span><span className="text-[10px]">#{pilotLowesStore.storeNumber}</span></Link>
              <Link href={selectedJob ? `/route?job=${selectedJob.id}&supplier=home-depot` : "/route?supplier=home-depot"} className="tap-target flex min-h-13 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-orange-400" aria-hidden /> Route through Home Depot</span><span className="text-[10px] text-ink-faint">#{pilotHomeDepotStore.storeNumber}</span></Link>
            </div>
          </section>
        </div>
      </div>
    </FieldPageShell>
  );
}
