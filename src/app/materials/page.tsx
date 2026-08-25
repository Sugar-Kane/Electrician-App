import Link from "next/link";
import { Boxes, CheckCircle2, ChevronRight, PackageSearch, Search, Settings2, Store, TriangleAlert } from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { MaterialSourcingWorkflow } from "@/components/material-sourcing-workflow";
import { pilotHomeDepotStore, pilotLowesStore, serviceBase } from "@/lib/pilot-data";
import { getInventory, getJobs, getSupplyStops } from "@/lib/job-data";
import { describeCoverage, matchMaterials, normalizeName } from "@/lib/inventory-match";

export default async function MaterialsPage({ searchParams }: { searchParams: Promise<{ job?: string; query?: string }> }) {
  const { job: jobId, query = "" } = await searchParams;

  // The business's own jobs, not the pilot fixtures. Materials have no table
  // yet, so a real job carries none and this page correctly shows nothing to
  // buy — which is honest, where a list of invented parts was not.
  const [{ jobs }, stock, stops] = await Promise.all([getJobs(), getInventory(), getSupplyStops()]);
  const selectedJob = jobId ? jobs.find((job) => job.id === jobId) : undefined;
  const allMaterials = (selectedJob ? selectedJob.materials : jobs.flatMap((job) => job.materials)).filter((material, index, materials) => materials.findIndex((candidate) => candidate.name === material.name) === index);

  /*
   * The search box searches stock.
   *
   * It used to filter `job.materials`, which `mapJob` sets to an empty array
   * for every real job — so the magnifying glass searched nothing at all and
   * always came back with nothing, on every business's screen. What somebody
   * standing at a van wants from a box on the materials page is "have I got
   * one of these", and that question is answered by the stock list.
   */
  const needle = normalizeName(query);
  const found = needle
    ? stock.filter(
        (item) =>
          normalizeName(item.name).includes(needle) ||
          normalizeName(item.partNumber).includes(needle) ||
          normalizeName(item.location).includes(needle),
      )
    : stock;

  const filtered = allMaterials;

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
    <FieldPageShell title="Material sourcing" eyebrow={selectedJob ? `Job #${selectedJob.id}` : "Inventory and suppliers"} description="What is on the van, and what a job still needs. Search finds anything in stock.">
      <div className="grid gap-4 lg:grid-cols-[1fr_.72fr]">
        {/* Same reason as the files page: a grid item will not shrink below its
            widest child unless told to, and a part number is a long word. */}
        <section className="min-w-0 rounded-panel border border-line bg-surface p-4 sm:p-6">
          <form action="/materials" className="flex gap-2">
            <input type="hidden" name="job" value={jobId ?? ""} />
            <label className="flex min-h-12 flex-1 items-center gap-2 rounded-control border border-line bg-raised px-4">
              <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
              <span className="sr-only">Search what is in stock</span>
              <input
                name="query"
                defaultValue={query}
                placeholder="Search stock…"
                className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint"
              />
            </label>
            <button
              className="tap-target grid h-12 w-12 place-items-center rounded-control bg-brand text-on-brand"
              aria-label="Search stock"
            >
              <PackageSearch className="h-5 w-5" aria-hidden />
            </button>
          </form>

          <section className="mt-4" aria-labelledby="stock-results">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 id="stock-results" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                {query ? `Stock matching “${query}”` : "What is on the van"}
              </h2>
              <Link href="/inventory" className="text-xs font-semibold text-brand">
                Manage stock
              </Link>
            </div>

            {found.length === 0 ? (
              <p className="mt-3 rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">
                {stock.length === 0
                  ? "Nothing in the stock list yet. Add what is already on the van and it shows up here."
                  : `Nothing in stock matches “${query}”.`}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {found.slice(0, 40).map((item) => (
                  <li key={item.id}>
                    <Link
                      href={`/inventory/${item.id}`}
                      prefetch
                      className="tap-row flex min-h-14 items-center gap-3 rounded-control border border-line bg-raised px-3"
                    >
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-white/5 text-brand">
                        <Boxes className="h-4 w-4" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold">{item.name}</span>
                        <span className="block truncate text-[11px] text-ink-faint">
                          {[item.partNumber, item.location].filter(Boolean).join(" · ")}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 text-sm font-semibold ${
                          item.quantity <= 0 ? "text-critical" : "text-ink"
                        }`}
                      >
                        {item.quantity} {item.unit}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {materials.length > 0 ? (
            <div className="mt-6 border-t border-line pt-5">
              <p className="rounded-control border border-line bg-white/[0.025] px-4 py-3 text-xs leading-5 text-ink-muted">
                {coverage}
              </p>
              <div className="mt-4">
                <MaterialSourcingWorkflow materials={materials} jobReference={jobId} nearAddress={nearAddress} />
              </div>
            </div>
          ) : null}
        </section>

        <div className="space-y-4">
          {selectedJob ? <Link href={`/jobs/${selectedJob.id}`} className="tap-row flex min-h-14 items-center justify-between rounded-panel border border-line bg-surface px-4"><span><span className="block text-xs text-ink-faint">Return to job</span><span className="block text-sm font-semibold">{selectedJob.customer}</span></span><ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden /></Link> : null}
          <section className="rounded-panel border border-caution/25 bg-caution-bg p-5">
            <div className="flex items-start gap-3"><TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-caution" aria-hidden /><div><p className="font-semibold text-caution">Retailer approval required for in-app data</p><p className="mt-2 text-sm leading-6 text-ink-muted">The prices above are pilot estimates, not retailer claims. The buttons open each retailer’s current results. Lowe’s store-level data requires Product Discovery approval; Home Depot offers a daily affiliate product feed, while live local inventory remains on its retailer page.</p><Link href="/settings/integrations" className="tap-target mt-3 inline-flex items-center gap-2 text-sm font-semibold text-brand"><Settings2 className="h-4 w-4" aria-hidden /> Manage supplier connections</Link></div></div>
          </section>
          <section className="rounded-panel border border-line bg-surface p-5">
            <div className="flex items-center gap-3"><Store className="h-5 w-5 text-brand" aria-hidden /><div><p className="text-xs text-ink-faint">Choose a supply stop</p><h2 className="font-semibold">Route after product review</h2></div></div>
            <ul className="mt-4 space-y-2 text-xs text-ink-muted"><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-positive" aria-hidden />Added only when truck stock is short</li><li className="flex gap-2"><CheckCircle2 className="h-4 w-4 text-positive" aria-hidden />Placed before the first job needing materials</li></ul>
            <div className="mt-4 space-y-2">
              {/*
                The business's own stops, when it has said what they are. The
                two hardcoded stores below were right for the pilot and forty
                miles wrong for anybody else — and neither of them is the
                storage unit where most of an electrician's stock actually
                lives.
              */}
              {stops.length > 0
                ? stops.slice(0, 3).map((stop) => (
                    <Link
                      key={stop.id}
                      href={selectedJob ? `/route?job=${selectedJob.id}` : "/route"}
                      prefetch
                      className={`tap-target flex min-h-13 items-center justify-between rounded-control px-4 text-sm font-semibold ${
                        stop.isDefault ? "bg-brand text-on-brand" : "border border-line"
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <Boxes className="h-4 w-4 shrink-0" aria-hidden />
                        <span className="truncate">Route through {stop.name}</span>
                      </span>
                      {stop.isDefault ? <span className="shrink-0 text-[10px]">first stop</span> : null}
                    </Link>
                  ))
                : (
                    <>
                      <Link href={selectedJob ? `/route?job=${selectedJob.id}&supplier=lowes` : "/route?supplier=lowes"} className="tap-target flex min-h-13 items-center justify-between rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"><span className="flex items-center gap-2"><Boxes className="h-4 w-4" aria-hidden /> Route through Lowe’s</span><span className="text-[10px]">#{pilotLowesStore.storeNumber}</span></Link>
                      <Link href={selectedJob ? `/route?job=${selectedJob.id}&supplier=home-depot` : "/route?supplier=home-depot"} className="tap-target flex min-h-13 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"><span className="flex items-center gap-2"><Boxes className="h-4 w-4 text-orange-400" aria-hidden /> Route through Home Depot</span><span className="text-[10px] text-ink-faint">#{pilotHomeDepotStore.storeNumber}</span></Link>
                    </>
                  )}

              <Link
                href="/supply-stops"
                prefetch
                className="tap-target flex min-h-13 items-center gap-2 rounded-control border border-dashed border-line px-4 text-sm font-semibold text-ink-muted"
              >
                <Store className="h-4 w-4 shrink-0" aria-hidden />
                {stops.length > 0 ? "Change your stops" : "Set your own stops"}
              </Link>
            </div>
          </section>
        </div>
      </div>
    </FieldPageShell>
  );
}
