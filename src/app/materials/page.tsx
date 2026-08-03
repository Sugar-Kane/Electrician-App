import Link from "next/link";
import { Boxes, CheckCircle2, ChevronRight, ExternalLink, PackageSearch, Search, Settings2, Store, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { buildHomeDepotSearchUrl, buildLowesSearchUrl, getPilotJob, pilotHomeDepotStore, pilotJobs, pilotLowesStore } from "@/lib/pilot-data";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ job?: string; query?: string }> }) {
  const { job: jobId, query = "" } = await searchParams;
  const selectedJob = jobId ? getPilotJob(jobId) : undefined;
  const allMaterials = (selectedJob ? selectedJob.materials : pilotJobs.flatMap((job) => job.materials)).filter((material, index, materials) => materials.findIndex((candidate) => candidate.name === material.name) === index);
  const normalized = query.trim().toLowerCase();
  const materials = normalized ? allMaterials.filter((material) => material.name.toLowerCase().includes(normalized)) : allMaterials;

  return (
    <FieldPageShell title="Material sourcing" eyebrow={selectedJob ? `Job #${selectedJob.id}` : "Inventory and suppliers"} description="Review what is already on the truck, identify shortages, and check live retailer results before adding a supply stop." active="More">
      <div className="grid gap-4 lg:grid-cols-[1fr_.72fr]">
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4 sm:p-6">
          <form action="/materials" className="flex gap-2"><input type="hidden" name="job" value={jobId ?? ""} /><label className="flex min-h-12 flex-1 items-center gap-2 rounded-2xl border border-white/10 bg-[#0d202d] px-4"><Search className="h-4 w-4 text-slate-500" aria-hidden /><span className="sr-only">Search required materials</span><input name="query" defaultValue={query} placeholder="Search materials…" className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-slate-500" /></label><button className="tap-target grid h-12 w-12 place-items-center rounded-2xl bg-[#ffc21c] text-[#071723]" aria-label="Search materials"><PackageSearch className="h-5 w-5" aria-hidden /></button></form>
          <div className="mt-5 space-y-3">
            {materials.map((material) => {
              const shortage = Math.max(0, material.quantity - material.truckStock);
              const estimatedTotal = shortage * material.estimatedUnitPrice;
              return (
                <article key={material.name} className="rounded-3xl border border-white/10 bg-white/[0.025] p-4">
                  <div className="flex items-start justify-between gap-3"><div><h2 className="text-base font-semibold">{material.name}</h2><p className="mt-1 text-xs text-slate-400">Need {material.quantity} {material.unit} · Truck has {material.truckStock}</p></div><span className={`shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold ${shortage > 0 ? "bg-amber-400/10 text-amber-300" : "bg-emerald-400/10 text-emerald-300"}`}>{shortage > 0 ? `Buy ${shortage}` : "On truck"}</span></div>
                  <div className="mt-4 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-white/[0.035] p-3"><p className="text-[10px] text-slate-500">Pilot unit estimate</p><p className="mt-1 text-lg font-semibold">${material.estimatedUnitPrice.toFixed(2)}</p></div><div className="rounded-2xl bg-white/[0.035] p-3"><p className="text-[10px] text-slate-500">Estimated shortage cost</p><p className="mt-1 text-lg font-semibold">${estimatedTotal.toFixed(2)}</p></div></div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    <a href={buildLowesSearchUrl(material.searchTerm)} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-between rounded-2xl border border-white/10 px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Store className="h-4 w-4 text-[#ffc21c]" aria-hidden /> Lowe’s live results</span><ExternalLink className="h-4 w-4 text-slate-500" aria-hidden /></a>
                    <a href={buildHomeDepotSearchUrl(material.searchTerm)} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-between rounded-2xl border border-white/10 px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Store className="h-4 w-4 text-orange-400" aria-hidden /> Home Depot live results</span><ExternalLink className="h-4 w-4 text-slate-500" aria-hidden /></a>
                  </div>
                </article>
              );
            })}
            {materials.length === 0 ? <p className="rounded-3xl border border-dashed border-white/15 p-8 text-center text-sm text-slate-400">No material matches found.</p> : null}
          </div>
        </section>

        <div className="space-y-4">
          {selectedJob ? <Link href={`/jobs/${selectedJob.id}`} className="tap-row flex min-h-14 items-center justify-between rounded-3xl border border-white/10 bg-[#0b1b27] px-4"><span><span className="block text-xs text-slate-500">Return to job</span><span className="block text-sm font-semibold">{selectedJob.customer}</span></span><ChevronRight className="h-5 w-5 text-slate-500" aria-hidden /></Link> : null}
          <section className="rounded-3xl border border-amber-400/25 bg-amber-400/[0.06] p-5">
            <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-300" aria-hidden /><div><p className="font-semibold text-amber-200">Retailer approval required for in-app data</p><p className="mt-2 text-sm leading-6 text-slate-300">The prices above are pilot estimates, not retailer claims. The buttons open each retailer’s current results. Lowe’s store-level data requires Product Discovery approval; Home Depot offers a daily affiliate product feed, while live local inventory remains on its retailer page.</p><Link href="/settings/integrations" className="tap-target mt-3 inline-flex items-center gap-2 text-sm font-semibold text-[#ffc21c]"><Settings2 className="h-4 w-4" aria-hidden /> Manage supplier connections</Link></div></div>
          </section>
          <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
            <div className="flex items-center gap-3"><Store className="h-5 w-5 text-[#ffc21c]" aria-hidden /><div><p className="text-xs text-slate-500">Choose a supply stop</p><h2 className="font-semibold">Route after product review</h2></div></div>
            <ul className="mt-4 space-y-2 text-xs text-slate-300"><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />Added only when truck stock is short</li><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden />Placed before the first job needing materials</li></ul>
            <div className="mt-4 space-y-2">
              <Link href={selectedJob ? `/route?job=${selectedJob.id}&supplier=lowes` : "/route?supplier=lowes"} className="tap-target flex min-h-13 items-center justify-between rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><span className="flex items-center gap-2"><Boxes className="h-4 w-4" aria-hidden /> Route through Lowe’s</span><span className="text-[10px]">#{pilotLowesStore.storeNumber}</span></Link>
              <Link href={selectedJob ? `/route?job=${selectedJob.id}&supplier=home-depot` : "/route?supplier=home-depot"} className="tap-target flex min-h-13 items-center justify-between rounded-2xl border border-white/10 px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-orange-400" aria-hidden /> Route through Home Depot</span><span className="text-[10px] text-slate-500">#{pilotHomeDepotStore.storeNumber}</span></Link>
            </div>
          </section>
        </div>
      </div>
    </FieldPageShell>
  );
}
