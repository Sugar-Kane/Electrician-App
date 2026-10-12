import Link from "next/link";
import { Boxes, ChevronRight, ExternalLink, PackageSearch, Search, Store, TriangleAlert } from "lucide-react";

import { AddToBuyList, BuyItemRow, BuyThisForJob } from "@/components/buy-list";
import { FieldPageShell } from "@/components/field-page-shell";
import { pilotHomeDepotStore, pilotLowesStore } from "@/lib/pilot-data";
import { buyStatusLabel, groupBySupplier, stillToGet, supplierSearchLinks } from "@/lib/buy-list";
import { getBuyList, getJobMaterials } from "@/lib/buy-list-data";
import { getInventory, getJobs, getSupplyStops } from "@/lib/job-data";
import { normalizeName } from "@/lib/inventory-match";

type Tab = "jobs" | "stock" | "buy";

/**
 * Materials: what jobs need, what is on the van, and what has to be bought.
 *
 * Three tabs rather than one long page. The old page answered "have I got one
 * of these" and then ran out: a search that found nothing ended in supplier
 * small print, and the part was still needed. Now a miss becomes a buy-list
 * line in one step, and the buy list is where it is followed through.
 *
 * Nothing here talks to a store. Prices, stock and pickups at a supplier are
 * whatever somebody was told and wrote down.
 */
export default async function MaterialsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; query?: string; job?: string }>;
}) {
  const { tab: requested, query = "", job: jobFilter } = await searchParams;
  const tab: Tab =
    requested === "stock" || requested === "buy" || requested === "jobs" ? requested : query ? "stock" : "jobs";

  const [{ jobs }, stock, stops, buyList] = await Promise.all([getJobs(), getInventory(), getSupplyStops(), getBuyList()]);
  const jobMaterials = (await getJobMaterials(buyList)).filter((entry) => !jobFilter || entry.jobNumber === jobFilter);

  const openJobs = jobs
    .filter((job) => job.status !== "Completed" && job.status !== "Canceled")
    .map((job) => ({ number: job.id, label: `#${job.id} · ${job.customer}` }));
  const stopChoices = stops.map((stop) => ({ id: stop.id, name: stop.name }));

  const needle = normalizeName(query);
  const found = needle
    ? stock.filter(
        (item) =>
          normalizeName(item.name).includes(needle) ||
          normalizeName(item.partNumber).includes(needle) ||
          normalizeName(item.location).includes(needle),
      )
    : stock;

  const toGet = buyList.filter(stillToGet);
  const partCount = jobMaterials.reduce((sum, entry) => sum + entry.lines.length, 0);
  const selectedJob = jobFilter ? jobs.find((job) => job.id === jobFilter) : undefined;

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "jobs", label: "For jobs", count: partCount },
    { id: "stock", label: "Van stock", count: stock.length },
    { id: "buy", label: "Buy list", count: toGet.length },
  ];
  const href = (id: Tab) => `/materials?tab=${id}${jobFilter ? `&job=${jobFilter}` : ""}`;

  return (
    <FieldPageShell
      title="Materials"
      eyebrow={selectedJob ? `Job #${selectedJob.id}` : "Parts and suppliers"}
      description="What jobs need, what is on the van, and what to buy."
    >
      <nav aria-label="Materials" className="mb-3 grid grid-cols-3 gap-1 rounded-control border border-line bg-surface p-1">
        {tabs.map((entry) => (
          <Link
            key={entry.id}
            href={href(entry.id)}
            aria-current={tab === entry.id ? "page" : undefined}
            className="tap-target flex min-h-11 flex-col items-center justify-center rounded-chip px-1 text-center text-xs font-semibold text-ink-muted aria-[current=page]:bg-brand/[0.12] aria-[current=page]:text-brand sm:flex-row sm:gap-1.5 sm:text-sm"
          >
            {entry.label}
            <span className="text-[11px] font-normal">{entry.count}</span>
          </Link>
        ))}
      </nav>

      <div className="grid gap-4 lg:grid-cols-[1fr_.6fr]">
        <section className="min-w-0 rounded-panel border border-line bg-surface p-4 sm:p-6">
          {tab === "jobs" ? (
            <ForJobs materials={jobMaterials} filtered={Boolean(jobFilter)} />
          ) : tab === "stock" ? (
            <VanStock
              query={query}
              found={found}
              stockCount={stock.length}
              jobs={openJobs}
              stops={stopChoices}
            />
          ) : (
            <BuyList items={buyList} jobs={openJobs} stops={stopChoices} />
          )}
        </section>

        <aside className="space-y-4">
          {selectedJob ? (
            <Link
              href={`/jobs/${selectedJob.id}`}
              className="tap-row flex min-h-14 items-center justify-between rounded-panel border border-line bg-surface px-4"
            >
              <span>
                <span className="block text-xs text-ink-faint">Return to job</span>
                <span className="block text-sm font-semibold">{selectedJob.customer}</span>
              </span>
              <ChevronRight className="h-5 w-5 text-ink-faint" aria-hidden />
            </Link>
          ) : null}
          <section className="rounded-panel border border-caution/25 bg-caution-bg p-5">
            <div className="flex items-start gap-3">
              <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-caution" aria-hidden />
              <p className="text-sm leading-6 text-ink-muted">
                Live store prices and stock aren’t connected. Check with the store before buying.
              </p>
            </div>
          </section>
          <SupplyStops stops={stops} jobId={selectedJob?.id} />
        </aside>
      </div>
    </FieldPageShell>
  );
}

function ForJobs({ materials, filtered }: { materials: Awaited<ReturnType<typeof getJobMaterials>>; filtered: boolean }) {
  if (materials.length === 0) {
    return (
      <p className="rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">
        {filtered
          ? "This job lists no parts yet. Add them under Work & materials on the job."
          : "No open job lists any parts yet. Parts added under a job's Work & materials show here."}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Parts open jobs need</h2>
      {materials.map((entry) => (
        <section key={entry.jobId} aria-labelledby={`job-${entry.jobId}`} className="rounded-control border border-line">
          <Link
            id={`job-${entry.jobId}`}
            href={`/jobs/${entry.jobNumber}#work-materials`}
            className="tap-row flex min-h-12 items-center justify-between gap-2 border-b border-line px-3 text-sm font-semibold"
          >
            <span className="min-w-0 truncate">
              #{entry.jobNumber} · {entry.customer}
            </span>
            <span className="shrink-0 text-xs font-normal text-ink-muted">{entry.whenLabel || "No time yet"}</span>
          </Link>
          <ul>
            {entry.lines.map((line) => (
              <li key={line.lineId} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-3 py-2 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm">{line.description}</span>
                  <span className="block text-xs text-ink-muted">
                    Needed: {Math.round(line.quantity * 100) / 100} {line.unit}
                  </span>
                </span>
                {line.fromStock ? (
                  <span className="shrink-0 rounded-chip border border-line px-2 py-1 text-xs text-ink-muted">Reserved from van</span>
                ) : line.bought ? (
                  <span className="shrink-0 rounded-chip border border-brand/40 px-2 py-1 text-xs font-semibold text-brand">
                    {buyStatusLabel(line.bought.status)}
                  </span>
                ) : (
                  <BuyThisForJob
                    description={line.description}
                    quantity={line.quantity}
                    unit={line.unit}
                    jobNumber={entry.jobNumber}
                  />
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function VanStock({
  query,
  found,
  stockCount,
  jobs,
  stops,
}: {
  query: string;
  found: Awaited<ReturnType<typeof getInventory>>;
  stockCount: number;
  jobs: { number: string; label: string }[];
  stops: { id: string; name: string }[];
}) {
  return (
    <>
      <form action="/materials" className="flex gap-2">
        <input type="hidden" name="tab" value="stock" />
        <label className="flex min-h-12 min-w-0 flex-1 items-center gap-2 rounded-control border border-line bg-raised px-4">
          <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          <span className="sr-only">Search what is in stock</span>
          <input
            name="query"
            defaultValue={query}
            placeholder="Search stock…"
            className="min-w-0 flex-1 bg-transparent text-base text-white outline-none placeholder:text-ink-faint"
          />
        </label>
        <button className="tap-target inline-flex h-12 shrink-0 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand">
          <PackageSearch className="h-5 w-5" aria-hidden />
          <span className="max-[359px]:sr-only">Search stock</span>
        </button>
      </form>

      <section className="mt-4" aria-labelledby="stock-results">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="stock-results" className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            {query ? `Stock matching “${query}”` : "What is on the van"}
          </h2>
          <Link href="/inventory" className="tap-target -my-2 inline-flex min-h-11 items-center px-2 text-xs font-semibold text-brand">
            Manage stock
          </Link>
        </div>

        {found.length === 0 && query ? (
          /*
           * A miss is a next step, not a dead end. "Not in your stock" says
           * only what this app knows — the van — and says nothing about any
           * store. The search is kept, so nothing is typed twice.
           */
          <div className="mt-3 space-y-3">
            <p className="rounded-control border border-dashed border-line p-4 text-sm">
              <span className="font-semibold">Not in your stock.</span>{" "}
              <span className="text-ink-muted">Nothing on your stock list matches “{query}”.</span>
            </p>
            <AddToBuyList description={query} jobs={jobs} stops={stops} />
            <div className="rounded-control border border-line p-3">
              <p className="text-sm font-semibold">Check supplier</p>
              <p className="mt-1 text-xs text-ink-muted">
                Opens the store’s own search. Whether they have it, and the price, is for them to say.
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                {supplierSearchLinks(query).map((link) => (
                  <a
                    key={link.href}
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                    className="tap-target inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line px-3 text-sm font-semibold"
                  >
                    {link.label}
                    <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                    <span className="sr-only">(opens a new tab)</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        ) : found.length === 0 ? (
          <p className="mt-3 rounded-control border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            {stockCount === 0
              ? "Nothing in the stock list yet. Add what is already on the van and it shows up here."
              : "Nothing in stock."}
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
                    className={`shrink-0 text-right text-sm font-semibold ${item.quantity <= 0 ? "text-critical" : "text-ink"}`}
                  >
                    {item.quantity} {item.unit}
                    {/* Some of what is on hand may be promised to open jobs. */}
                    {item.reserved > 0 ? (
                      <span className="block text-[11px] font-normal text-ink-faint">
                        {Math.round(item.reserved * 100) / 100} reserved
                      </span>
                    ) : null}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

function BuyList({
  items,
  jobs,
  stops,
}: {
  items: Awaited<ReturnType<typeof getBuyList>>;
  jobs: { number: string; label: string }[];
  stops: { id: string; name: string }[];
}) {
  const open = items.filter(stillToGet);
  const done = items.filter((item) => !stillToGet(item));

  return (
    <div className="space-y-4">
      {open.length === 0 ? (
        <>
          <p className="rounded-control border border-dashed border-line p-4 text-center text-sm text-ink-muted">
            Nothing to buy. A part a job needs, or a stock search that finds nothing, can be added here.
          </p>
          <AddToBuyList heading="Add something to buy" jobs={jobs} stops={stops} />
        </>
      ) : (
        <>
          <details className="group rounded-control border border-line">
            <summary className="tap-target flex min-h-12 cursor-pointer list-none items-center px-3 text-sm font-semibold text-brand [&::-webkit-details-marker]:hidden">
              Add something to buy
            </summary>
            <div className="p-3 pt-0">
              <AddToBuyList heading="Add something to buy" jobs={jobs} stops={stops} />
            </div>
          </details>
          {groupBySupplier(open).map((group) => (
            <section key={group.supplyStopId ?? "none"} aria-label={group.supplierName}>
              <h2 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
                <Store className="h-3.5 w-3.5" aria-hidden />
                {group.supplierName}
              </h2>
              <ul className="space-y-2">
                {group.items.map((item) => (
                  <BuyItemRow key={item.id} item={item} />
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {done.length > 0 ? (
        <details className="rounded-control border border-line">
          <summary className="tap-target flex min-h-12 cursor-pointer list-none items-center px-3 text-sm font-semibold text-ink-muted [&::-webkit-details-marker]:hidden">
            Picked up ({done.length})
          </summary>
          <ul className="space-y-2 p-3 pt-0">
            {done.map((item) => (
              <BuyItemRow key={item.id} item={item} />
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

function SupplyStops({ stops, jobId }: { stops: Awaited<ReturnType<typeof getSupplyStops>>; jobId?: string }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-5">
      <div className="flex items-center gap-3">
        <Store className="h-5 w-5 text-brand" aria-hidden />
        <div>
          <p className="text-xs text-ink-faint">Where you pick parts up</p>
          <h2 className="font-semibold">Supply stops</h2>
        </div>
      </div>
      {/* Said the way the route behaves, not as a promise about any store. */}
      <p className="mt-3 text-xs leading-5 text-ink-muted">
        A stop goes on the day’s route only when a job that day has something on the buy list to collect. You can
        still add one by hand on the route.
      </p>
      <div className="mt-4 space-y-2">
        {stops.length > 0
          ? stops.slice(0, 3).map((stop) => (
              <Link
                key={stop.id}
                href={jobId ? `/route?job=${jobId}&stop=add` : "/route?stop=add"}
                prefetch
                className="tap-target flex min-h-13 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Boxes className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="truncate">Route through {stop.name}</span>
                </span>
                {stop.isDefault ? <span className="shrink-0 text-[10px] text-ink-faint">usual</span> : null}
              </Link>
            ))
          : (
              <>
                <Link
                  href={jobId ? `/route?job=${jobId}&supplier=lowes&stop=add` : "/route?supplier=lowes&stop=add"}
                  className="tap-target flex min-h-13 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"
                >
                  <span className="flex items-center gap-2">
                    <Boxes className="h-4 w-4" aria-hidden /> Route through Lowe’s
                  </span>
                  <span className="text-[10px] text-ink-faint">#{pilotLowesStore.storeNumber}</span>
                </Link>
                <Link
                  href={jobId ? `/route?job=${jobId}&supplier=home-depot&stop=add` : "/route?supplier=home-depot&stop=add"}
                  className="tap-target flex min-h-13 items-center justify-between rounded-control border border-line px-4 text-sm font-semibold"
                >
                  <span className="flex items-center gap-2">
                    <Boxes className="h-4 w-4 text-orange-400" aria-hidden /> Route through Home Depot
                  </span>
                  <span className="text-[10px] text-ink-faint">#{pilotHomeDepotStore.storeNumber}</span>
                </Link>
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
  );
}
