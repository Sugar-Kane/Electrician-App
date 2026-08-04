"use client";

import { useSyncExternalStore } from "react";
import { ChevronRight, Crosshair, MapPin, Navigation } from "lucide-react";

import { buildAppleDirectionsUrl, buildGoogleDirectionsUrl, serviceBase } from "@/lib/pilot-data";
import {
  getRouteStartServerSnapshot,
  getRouteStartSnapshot,
  resolveRouteStart,
  subscribeRouteStart,
} from "@/lib/route-start";
import { useCurrentPosition } from "@/lib/use-current-position";

/**
 * Reads the start location the driver picked in the route builder so a single
 * job navigates from the same place the full route would.
 */
function useJobDirections(destination: string) {
  const storedStart = useSyncExternalStore(subscribeRouteStart, getRouteStartSnapshot, getRouteStartServerSnapshot);
  const { position, status, error, request } = useCurrentPosition();
  const start = resolveRouteStart(storedStart, position, serviceBase);

  return {
    start,
    googleUrl: buildGoogleDirectionsUrl([start.address, destination]),
    appleUrl: buildAppleDirectionsUrl(destination, start.address),
    // A GPS start needs a fresh fix on this page; the route builder's reading is
    // deliberately not persisted. Offer the read rather than prompting on load.
    needsPosition: storedStart.mode === "current" && !position,
    geoStatus: status,
    geoError: error,
    requestPosition: request,
  };
}

export function JobAddressLink({ address, city }: { address: string; city: string }) {
  const { appleUrl } = useJobDirections(`${address}, ${city}`);

  return (
    <a href={appleUrl} target="_blank" rel="noreferrer" className="tap-row flex min-h-14 items-center gap-3 rounded-2xl border border-white/10 px-3">
      <MapPin className="h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{address}</span><span className="block text-xs text-slate-400">{city}</span></span>
      <ChevronRight className="h-4 w-4 text-slate-500" aria-hidden />
    </a>
  );
}

export function JobDirectionsButtons({ destination }: { destination: string }) {
  const { start, googleUrl, appleUrl, needsPosition, geoStatus, geoError, requestPosition } = useJobDirections(destination);

  return (
    <>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <a href={googleUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-white/10 text-xs"><Navigation className="h-4 w-4" aria-hidden /> Google</a>
        <a href={appleUrl} target="_blank" rel="noreferrer" className="tap-target flex min-h-12 items-center justify-center gap-1.5 rounded-2xl border border-white/10 text-xs"><Navigation className="h-4 w-4" aria-hidden /> Apple</a>
      </div>
      {needsPosition ? (
        <button type="button" onClick={() => requestPosition()} disabled={geoStatus === "locating"} className="tap-target mt-2 flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl border border-white/10 bg-white/[0.025] px-3 text-[11px] font-semibold text-slate-200 disabled:opacity-60">
          <Crosshair className="h-4 w-4" aria-hidden />
          {geoStatus === "locating" ? "Locating…" : "Use my current location"}
        </button>
      ) : null}
      {geoStatus === "error" ? <p role="status" className="mt-2 rounded-xl bg-red-400/[0.08] px-3 py-2 text-[10px] leading-4 text-red-300">{geoError}</p> : null}
      <p className="mt-2 text-center text-[10px] text-slate-500">Starting from {start.phrase}{start.usingFallback ? " · set a start in the route builder" : ""}</p>
    </>
  );
}
