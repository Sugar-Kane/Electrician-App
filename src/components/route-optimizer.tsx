"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import { Boxes, Check, ChevronLeft, Clock3, Crosshair, Home, MapPin, Navigation, RotateCcw, Route, Sparkles, Store } from "lucide-react";

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
import {
  cleanStartAddress,
  formatAccuracy,
  formatCoordinates,
  getRouteStartServerSnapshot,
  getRouteStartSnapshot,
  maximumStartAddressLength,
  resolveRouteStart,
  subscribeRouteStart,
  writeStoredRouteStart,
  type RouteStartMode,
} from "@/lib/route-start";
import { useCurrentPosition } from "@/lib/use-current-position";
import {
  buildRouteKey,
  getRouteProgressServerSnapshot,
  getRouteProgressSnapshot,
  resolveLegIndex,
  subscribeRouteProgress,
  writeRouteProgress,
} from "@/lib/route-progress";

type RouteStop = {
  id: string;
  label: string;
  address: string;
  detail: string;
  kind: "base" | "supply" | "job";
  job?: PilotJob;
};

const startModeOptions: { id: RouteStartMode; label: string; icon: typeof Home }[] = [
  { id: "base", label: "Shop", icon: Store },
  { id: "current", label: "My location", icon: Crosshair },
  { id: "custom", label: "Home address", icon: Home },
];

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

  // The driver's saved start lives in localStorage so it survives navigation.
  // useSyncExternalStore keeps the server render (always the shop) free of
  // hydration mismatches while still picking up the stored choice in the browser.
  const storedStart = useSyncExternalStore(subscribeRouteStart, getRouteStartSnapshot, getRouteStartServerSnapshot);
  const startMode = storedStart.mode;
  const savedStartAddress = storedStart.customAddress;

  const [addressDraft, setAddressDraft] = useState<string | undefined>();
  const startAddressDraft = addressDraft ?? savedStartAddress;
  const { position, status: geoStatus, error: geoError, request } = useCurrentPosition();

  function requestCurrentPosition() {
    request(() => setBuilt(false));
  }

  function selectStartMode(mode: RouteStartMode) {
    writeStoredRouteStart({ mode, customAddress: savedStartAddress });
    setBuilt(false);
    if (mode === "current" && !position && geoStatus !== "locating") requestCurrentPosition();
  }

  function saveStartAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = cleanStartAddress(startAddressDraft);
    writeStoredRouteStart({ mode: "custom", customAddress: cleaned });
    setAddressDraft(cleaned);
    setBuilt(false);
  }

  const resolvedStart = resolveRouteStart(storedStart, position, serviceBase);
  const usingFallbackStart = resolvedStart.usingFallback;

  const startStop = useMemo<RouteStop>(() => {
    if (startMode === "current" && position) {
      return { id: "start-current", label: resolvedStart.label, address: resolvedStart.address, detail: `Route start · GPS ${formatAccuracy(position.accuracyMeters)}`, kind: "base" };
    }
    if (startMode === "custom" && savedStartAddress) {
      return { id: "start-custom", label: resolvedStart.label, address: resolvedStart.address, detail: "Route start · saved on this device", kind: "base" };
    }
    return { id: "start-base", label: resolvedStart.label, address: resolvedStart.address, detail: "Route start · shop", kind: "base" };
  }, [position, resolvedStart.address, resolvedStart.label, savedStartAddress, startMode]);

  const routeStops = useMemo<RouteStop[]>(() => {
    const today = pilotJobs.filter((job) => job.date === "2026-08-03");
    const focusJob = focusJobId ? getPilotJob(focusJobId) : undefined;
    const selectedJobs = focusJob
      ? [focusJob, ...today.filter((job) => job.id !== focusJob.id).slice(0, 2)]
      : [today[0], today[2], today[3]].filter(Boolean);

    return [
      startStop,
      { id: supplyStore.id, label: supplyStore.name, address: supplyStore.address, detail: `Supply pickup${supplyStore.storeNumber ? ` · Store #${supplyStore.storeNumber}` : ""} · user-confirmed retailer stop`, kind: "supply" },
      ...selectedJobs.map((job) => ({ id: job.id, label: job.customer, address: `${job.address}, ${job.city}`, detail: `${job.time} · ${job.workType}`, kind: "job" as const, job })),
    ];
  }, [focusJobId, startStop, supplyStore]);

  const addresses = routeStops.map((stop) => stop.address);
  const googleUrl = buildGoogleDirectionsUrl(addresses);

  // Apple Map Links accept a single destination, so the route is handed over one
  // leg at a time. Progress lives in sessionStorage so leaving for Apple Maps and
  // coming back resumes the right leg. It is keyed on the destinations only: a
  // GPS start is not restored after a reload, and that change of origin must not
  // throw away progress through the stops.
  const routeKey = buildRouteKey(routeStops.slice(1).map((stop) => stop.id));
  const storedProgress = useSyncExternalStore(subscribeRouteProgress, getRouteProgressSnapshot, getRouteProgressServerSnapshot);
  const legIndex = resolveLegIndex(storedProgress, routeKey, routeStops.length);
  const routeComplete = legIndex >= routeStops.length;
  const legOrigin = routeStops[legIndex - 1] ?? startStop;
  const legDestination = routeStops[legIndex];
  const appleUrl = buildAppleDirectionsUrl(legDestination?.address ?? startStop.address, legOrigin.address);

  function goToLeg(nextLeg: number) {
    writeRouteProgress({ routeKey, legIndex: Math.min(Math.max(nextLeg, 1), routeStops.length) });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_.8fr]">
      <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-4 sm:p-6">
        <div className="flex items-start justify-between gap-3"><div><p className="text-xs text-slate-500">Central Coast route</p><h2 className="mt-1 text-xl font-semibold">{built ? "Optimized route ready" : "Route waiting to be built"}</h2></div><span className={`grid h-11 w-11 place-items-center rounded-2xl ${built ? "bg-emerald-400 text-[#071723]" : "bg-[#ffc21c] text-[#071723]"}`}>{built ? <Check className="h-5 w-5" aria-hidden /> : <Route className="h-5 w-5" aria-hidden />}</span></div>

        <div className="mt-5">
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Start location</p>
          <div className="grid grid-cols-3 gap-2">
            {startModeOptions.map((option) => {
              const selected = startMode === option.id;
              const Icon = option.icon;
              return (
                <button key={option.id} type="button" onClick={() => selectStartMode(option.id)} className={`tap-target min-h-14 rounded-2xl border px-2 text-center ${selected ? "border-[#ffc21c]/60 bg-[#ffc21c]/10 text-[#ffc21c]" : "border-white/10 bg-white/[0.025] text-slate-300"}`} aria-pressed={selected}>
                  <Icon className="mx-auto h-4 w-4" aria-hidden />
                  <span className="mt-1 block text-[11px] font-semibold leading-tight">{option.label}</span>
                </button>
              );
            })}
          </div>

          {startMode === "current" ? (
            <div className="mt-2 space-y-2">
              <button type="button" onClick={requestCurrentPosition} disabled={geoStatus === "locating"} className="tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] px-3 text-xs font-semibold text-slate-200 disabled:opacity-60">
                <Crosshair className="h-4 w-4" aria-hidden />
                {geoStatus === "locating" ? "Locating…" : position ? "Refresh my location" : "Use my current location"}
              </button>
              {position ? <p className="flex items-start gap-1.5 rounded-xl bg-emerald-400/[0.06] px-3 py-2 text-[10px] leading-4 text-emerald-300"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Starting from {formatCoordinates(position)} · GPS {formatAccuracy(position.accuracyMeters)}</p> : null}
              {geoStatus === "error" ? <p role="status" className="rounded-xl bg-red-400/[0.08] px-3 py-2 text-[10px] leading-4 text-red-300">{geoError}</p> : null}
            </div>
          ) : null}

          {startMode === "custom" ? (
            <form onSubmit={saveStartAddress} className="mt-2 space-y-2">
              <label htmlFor="route-start-address" className="sr-only">Home or start address</label>
              <input id="route-start-address" name="startAddress" type="text" autoComplete="street-address" inputMode="text" maxLength={maximumStartAddressLength} value={startAddressDraft} onChange={(event) => setAddressDraft(event.target.value)} placeholder="123 Oak St, Nipomo, CA 93444" className="min-h-12 w-full rounded-2xl border border-white/10 bg-white/[0.025] px-3 text-sm text-slate-100 placeholder:text-slate-600" />
              <button type="submit" className="tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] px-3 text-xs font-semibold text-slate-200">Save start address</button>
              {savedStartAddress ? <p className="flex items-start gap-1.5 rounded-xl bg-emerald-400/[0.06] px-3 py-2 text-[10px] leading-4 text-emerald-300"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Starting from {savedStartAddress}</p> : null}
            </form>
          ) : null}

          {usingFallbackStart ? <p className="mt-2 rounded-xl bg-white/[0.04] px-3 py-2 text-[10px] leading-4 text-slate-400">Using {serviceBase.name} as the start until a location is set.</p> : null}
        </div>

        <div className="mt-5"><p className="mb-2 text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Supply stop</p><div className="grid grid-cols-2 gap-2">{(["lowes", "home-depot"] as const).map((supplierId) => { const store = getPilotSupplyStore(supplierId); const selected = supplier === supplierId; return <button key={supplierId} type="button" onClick={() => { setSupplier(supplierId); setSelectedSupplyStore(undefined); setBuilt(false); }} className={`tap-target min-h-14 rounded-2xl border px-3 text-left ${selected ? "border-[#ffc21c]/60 bg-[#ffc21c]/10 text-[#ffc21c]" : "border-white/10 bg-white/[0.025] text-slate-300"}`} aria-pressed={selected}><span className="block text-sm font-semibold">{store.shortName}</span><span className="mt-0.5 block text-[10px] opacity-70">Store #{store.storeNumber}</span></button>; })}</div>{selectedSupplyStore?.supplier === supplier ? <p className="mt-2 flex items-start gap-1.5 rounded-xl bg-emerald-400/[0.06] px-3 py-2 text-[10px] leading-4 text-emerald-300"><MapPin className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Using the store confirmed with the saved product: {selectedSupplyStore.address}</p> : null}</div>

        <div className="mt-5 space-y-0">
          {routeStops.map((stop, index) => {
            const done = built && index < legIndex;
            const current = built && index === legIndex;
            return (
            <div key={stop.id} className="relative flex gap-3 pb-5 last:pb-0">
              {index < routeStops.length - 1 ? <span className="absolute left-[21px] top-10 h-[calc(100%-24px)] w-px bg-white/10" /> : null}
              <span className={`relative z-10 grid h-11 w-11 shrink-0 place-items-center rounded-2xl border text-sm font-semibold ${current ? "border-[#ffc21c] bg-[#ffc21c] text-[#071723]" : done ? "border-emerald-400/40 bg-emerald-400/15 text-emerald-300" : stop.kind === "supply" ? "border-[#ffc21c]/40 bg-[#ffc21c]/10 text-[#ffc21c]" : stop.kind === "base" ? "border-white/10 bg-white/5 text-slate-300" : "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"}`}>{done ? <Check className="h-4 w-4" aria-hidden /> : index + 1}</span>
              <div className={`min-w-0 flex-1 pt-0.5 ${done ? "opacity-60" : ""}`}><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">{stop.label}{current ? <span className="ml-2 rounded-full bg-[#ffc21c]/15 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.08em] text-[#ffc21c]">Next stop</span> : null}</p><p className="mt-1 text-[11px] text-slate-400">{stop.detail}</p><p className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-500"><MapPin className="h-3 w-3" aria-hidden />{stop.address}</p></div>{stop.job ? <Link href={`/jobs/${stop.job.id}`} className="tap-target inline-flex items-center text-[10px] font-semibold text-[#ffc21c]">Job #{stop.job.id}</Link> : null}</div>
              {built && index > 0 ? <a href={buildAppleDirectionsUrl(stop.address, routeStops[index - 1].address)} target="_blank" rel="noreferrer" onClick={() => goToLeg(index)} className="tap-target mt-2 inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.025] px-3 text-[11px] font-semibold text-slate-200"><Navigation className="h-3 w-3" aria-hidden />Navigate this stop</a> : null}</div>
            </div>
            );
          })}
        </div>
      </section>

      <div className="space-y-4">
        <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5">
          <div className="flex items-center gap-3"><Sparkles className="h-5 w-5 text-[#ffc21c]" aria-hidden /><div><p className="text-xs text-slate-500">Optimization rules</p><h2 className="font-semibold">Appointments first, less driving second</h2></div></div>
          <ul className="mt-4 space-y-3 text-sm text-slate-300"><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Starts from your location, home address, or the shop</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Keeps promised appointment order</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Adds the supply stop before materials are needed</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Limits the handoff to three mobile Google waypoints</li><li className="flex gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden />Walks Apple Maps through the same order one leg at a time</li></ul>
          {built ? <div className="mt-5 grid grid-cols-2 gap-2"><div className="rounded-2xl bg-white/[0.04] p-3"><Clock3 className="h-4 w-4 text-slate-500" aria-hidden /><p className="mt-2 text-lg font-semibold">2h 06m</p><p className="text-[10px] text-slate-500">Estimated driving</p></div><div className="rounded-2xl bg-white/[0.04] p-3"><Navigation className="h-4 w-4 text-slate-500" aria-hidden /><p className="mt-2 text-lg font-semibold">78 mi</p><p className="text-[10px] text-slate-500">Estimated route</p></div></div> : null}
        </section>

        {!built ? (
          <button type="button" onClick={() => setBuilt(true)} className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 text-sm font-semibold text-[#071723] shadow-lg shadow-yellow-500/10"><Route className="h-5 w-5" aria-hidden /> Build optimized route</button>
        ) : (
          <section className="rounded-3xl border border-[#ffc21c]/30 bg-[#0b1b27] p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-[#ffc21c]">Route built</p><p className="mt-2 text-sm leading-6 text-slate-300">The order above is locked before navigation opens, starting from {resolvedStart.phrase}. Google receives the full ordered route. Apple Map Links carry one destination each, so Apple runs the same route leg by leg.</p>
            <div className="mt-4 space-y-2"><a href={googleUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-13 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-4 text-sm font-semibold text-[#071723]"><Navigation className="h-4 w-4" aria-hidden /> Open full route in Google Maps</a></div>

            <div className="mt-5 border-t border-white/10 pt-4">
              <div className="flex items-center justify-between gap-2"><p className="text-xs font-semibold uppercase tracking-[0.1em] text-slate-500">Apple Maps · stop by stop</p><p className="text-[10px] text-slate-500">Stop {Math.min(legIndex + 1, routeStops.length)} of {routeStops.length}</p></div>

              {routeComplete || !legDestination ? (
                <div className="mt-3 space-y-2">
                  <p className="flex items-start gap-1.5 rounded-xl bg-emerald-400/[0.06] px-3 py-2 text-[11px] leading-4 text-emerald-300"><Check className="mt-0.5 h-3 w-3 shrink-0" aria-hidden />Every stop on this route has been navigated.</p>
                  <button type="button" onClick={() => goToLeg(1)} className="tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] px-4 text-xs font-semibold text-slate-200"><RotateCcw className="h-4 w-4" aria-hidden /> Start the route over</button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-semibold">{legDestination.label}</p>
                  <p className="flex items-center gap-1.5 text-[11px] text-slate-500"><MapPin className="h-3 w-3" aria-hidden />{legDestination.address}</p>
                  <p className="text-[10px] text-slate-500">Departing from {legOrigin.label}</p>
                  <a href={appleUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-13 items-center justify-center gap-2 rounded-2xl border border-white/10 px-4 text-sm font-semibold"><Navigation className="h-4 w-4" aria-hidden /> Open stop {legIndex + 1} in Apple Maps</a>
                  <div className="grid grid-cols-[auto_1fr] gap-2">
                    <button type="button" onClick={() => goToLeg(legIndex - 1)} disabled={legIndex <= 1} className="tap-target flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-white/10 bg-white/[0.025] px-3 text-xs font-semibold text-slate-300 disabled:opacity-40"><ChevronLeft className="h-4 w-4" aria-hidden /><span className="sr-only">Previous stop</span></button>
                    <button type="button" onClick={() => goToLeg(legIndex + 1)} className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-emerald-400/30 bg-emerald-400/10 px-4 text-xs font-semibold text-emerald-300"><Check className="h-4 w-4" aria-hidden /> Arrived · next stop</button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}

        <Link href="/materials" className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-2xl border border-white/10 text-sm"><Boxes className="h-4 w-4" aria-hidden /> Review material shortages</Link>
      </div>
    </div>
  );
}
