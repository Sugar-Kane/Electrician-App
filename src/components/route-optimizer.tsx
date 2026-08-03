"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Boxes, Check, Clock3, MapPin, Navigation, Route, Sparkles } from "lucide-react";

import {
  buildAppleDirectionsUrl,
  buildGoogleDirectionsUrl,
  getPilotJob,
  getPilotSupplyStore,
  pilotJobs,
  serviceBase,
  type PilotJob,
  type SupplyStore,
  type SupplierId,
} from "@/lib/pilot-data";

type RouteStop = {
  id: string;
  label: string;
  address: string;
  detail: string;
  kind: "base" | "supply" | "job";
  job?: PilotJob;
};

export function RouteOptimizer({
  focusJobId,
  initialSupplier = "lowes",
  initialSupplyStore,
}: {
  focusJobId?: string;
  initialSupplier?: SupplierId;
  initialSupplyStore?: SupplyStore;
}) {
  const [built, setBuilt] = useState(false);
  const [supplier, setSupplier] = useState<SupplierId>(initialSupplier);
  const [selectedSupplyStore, setSelectedSupplyStore] = useState<SupplyStore | undefined>(initialSupplyStore);
  const supplyStore = selectedSupplyStore?.supplier === supplier ? selectedSupplyStore : getPilotSupplyStore(supplier);

  const routeStops = useMemo<RouteStop[]>(() => {
    const today = pilotJobs.filter((job) => job.date === "2026-08-03");
    const focusJob = focusJobId ? getPilotJob(focusJobId) : undefined;
    const selectedJobs = focusJob
      ? [focusJob, ...today.filter((job) => job.id !== focusJob.id).slice(0, 2)]
      : [today[0], today[2], today[3]].filter(Boolean);

    return [
      { id: "base", label: serviceBase.name, address: serviceBase.address, detail: "Route start", kind: "base" },
      { id: supplyStore.id, label: supplyStore.name, address: supplyStore.address, detail: `Supply pickup${supplyStore.storeNumber ? ` · Store #${supplyStore.storeNumber}` : ""} · user-confirmed retailer stop`, kind: "supply" },
      ...selectedJobs.map((job) => ({ id: job.id, label: job.customer, address: `${job.address}, ${job.city}`, detail: `${job.time} · ${job.workType}`, kind: "job" as const, job })),
    ];
  }, [focusJobId, supplyStore]);

  const addresses = routeStops.map((stop) => stop.address);
  const googleUrl = buildGoogleDirectionsUrl(addresses);
  const appleUrl = buildAppleDirectionsUrl(routeStops[1]?.address ?? serviceBase.address);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_.8fr]">
      <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-500">Central Coast route</p><h2 className="mt-1 text-xl font-semibold">{built ? "Optimized route ready" : "Route waiting to be built"}</h2></div><span className={`grid h-11 w-11 place-items-center rounded-2xl ${built ? "bg-emerald-400 text-[#071723]" : "bg-[#ffc21c] text-[#071723]"}`}>{built ? <Check className="h-5 w-5" aria-hidden /> : <Route className="h-5 w-5" aria-hidden />}</span></div>

        <div className="mt-5"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Supply stop</p><div className="grid grid-cols-2 gap-2">{(["lowes", "home-depot"] as const).map((supplierId) => { const store = getPilotSupplyStore(supplierId); const selected = supplier === supplierId; return <button key={supplierId} type="button" onClick={() => { setSupplier(supplierId); setSelectedSupplyStore(undefined); setBuilt(false); }} className={`tap-target min-h-14 rounded-2xl border px-3 text-left ${selected ? "border-[#ffc21c]/60 bg-[#ffc21c]/10 text-[#ffc21c]" : "border-white/10 bg-white/[0.025] text-slate-300"}`} aria-pressed={selected}><span className="block text-sm font-semibold">{store.shortName}</span><span className="mt-0.5 block text-[10px] opacity-70">Store #{store.storeNumber}</span></button>; })}</div>{selectedSupplyStore?.supplier === supplier ? <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-emerald-400/[0.06] px-3 py-2 text-[10px] leading-4 text-emerald-300"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Using the store confirmed with the saved product: {selectedSupplyStore.address}</p> : null}</div>

        <div className="mt-5 space-y-0">
          {routeStops.map((stop, index) => (
            <div key={stop.id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < routeStops.length - 1 ? <span className="absolute left-[21px] top-10 h-[calc(100%-24px)] w-px bg-white/10" /> : null}
              <span className={`relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-sm font-semibold ${stop.kind === "supply" ? "border-[#ffc21c]/40 bg-[#ffc21c]/10 text-[#ffc21c]" : stop.kind === "base" ? "border-white/10 bg-white/5 text-slate-300" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"}`}>{index + 1}</span>
              <div className="min-w-0 flex-1 pt-0.5"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">{stop.label}</p><p className="mt-1 text-[11px] text-slate-400">{stop.detail}</p><p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><MapPin className="h-3 w-3" aria-hidden />{stop.address}</p></div>{stop.job ? <Link href={`/jobs/${stop.job.id}`} className="tap-target inline-flex items-center text-[10px] font-semibold text-[#ffc21c]">Job #{stop.job.id}</Link> : null}</div></div>
            </div>
          ))}
        </div>
      </section>

      <div className="space-y-4">
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
          <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-[#ffc21c]" aria-hidden /><div><p className="text-xs text-slate-500">Optimization rules</p><h2 className="font-semibold">Appointments first, less driving second</h2></div></div>
          <ul className="mt-4 space-y-3 text-sm text-slate-300"><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Keeps promised appointment order</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Adds the supply stop before materials are needed</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Limits the handoff to three mobile Google waypoints</li></ul>
          {built ? <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-white/[0.04] p-3"><Clock3 className="h-4 w-4 text-slate-500" aria-hidden /><p className="mt-2 text-lg font-semibold">2h 06m</p><p className="text-[10px] text-slate-500">Estimated driving</p></div><div className="rounded-2xl bg-white/[0.04] p-3"><Navigation className="h-4 w-4 text-slate-500" aria-hidden /><p className="mt-2 text-lg font-semibold">78 mi</p><p className="text-[10px] text-slate-500">Estimated route</p></div></div> : null}
        </section>

        {!built ? (
          <button type="button" onClick={() => setBuilt(true)} className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] shadow-lg shadow-yellow-500/10"><Route className="h-5 w-5" aria-hidden /> Build optimized route</button>
        ) : (
          <section className="rounded-3xl border border-[#ffc21c]/30 bg-[#0b1b27] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#ffc21c]">Route built</p><p className="mt-2 text-sm leading-6 text-slate-300">The order above is locked before navigation opens. Google receives the full ordered route; Apple opens the next stop because Apple Map Links do not accept multi-stop waypoints.</p>
            <div className="mt-4 space-y-2"><a href={googleUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><Navigation className="h-4 w-4" aria-hidden /> Open full route in Google Maps</a><a href={appleUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-semibold"><Navigation className="h-4 w-4" aria-hidden /> Open next stop in Apple Maps</a></div>
          </section>
        )}

        <Link href="/materials" className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 text-sm"><Boxes className="h-4 w-4" aria-hidden /> Review material shortages</Link>
      </div>
    </div>
  );
}
