"use client";

import { useMemo, useState, useSyncExternalStore } from "react";
import { Crosshair, LoaderCircle, MapPin } from "lucide-react";

import { JobMap, type MapStop } from "@/components/job-map";
import { hasCoordinates } from "@/lib/coordinates";
import type { PilotJob } from "@/lib/pilot-data";
import {
  getRouteStartServerSnapshot,
  getRouteStartSnapshot,
  subscribeRouteStart,
  writeStoredRouteStart,
  type RouteStartPosition,
} from "@/lib/route-start";

/**
 * The day on a map.
 *
 * The route builder used to describe stops in a list and offer to open an
 * external maps app; the only map in the product was a decorative SVG on the
 * dashboard that could not be clicked. This is the actual thing.
 *
 * Sharing a location writes it to the same store the route builder reads, so
 * "my location" set here is the origin the built route departs from — they were
 * previously two separate ideas of where the driver is.
 */
export function RouteMap({
  jobs,
  today,
  apiKey,
  unplaced,
}: {
  jobs: PilotJob[];
  today: string;
  apiKey: string;
  /**
   * Addresses that could not be turned into a point, each with the reason the
   * geocoder gave — "could not place this" is true and tells nobody which
   * console page to open.
   */
  unplaced: { address: string; reason: string }[];
}) {
  const [position, setPosition] = useState<RouteStartPosition | undefined>();
  const [locating, setLocating] = useState(false);
  const [locationError, setLocationError] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const storedStart = useSyncExternalStore(
    subscribeRouteStart,
    getRouteStartSnapshot,
    getRouteStartServerSnapshot,
  );

  const todaysJobs = useMemo(
    () => jobs.filter((job) => job.date === today && job.status !== "Canceled"),
    [jobs, today],
  );

  const stops: MapStop[] = useMemo(
    () =>
      todaysJobs
        .filter((job) => hasCoordinates(job.coordinates))
        .map((job) => ({
          id: job.id,
          label: job.customer,
          sublabel: `${job.time} · ${job.address}, ${job.city}`,
          point: job.coordinates!,
        })),
    [todaysJobs],
  );

  const missing = todaysJobs.filter((job) => !hasCoordinates(job.coordinates));

  function shareLocation() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setLocationError("This browser cannot share a location.");
      return;
    }
    setLocating(true);
    setLocationError("");

    navigator.geolocation.getCurrentPosition(
      (result) => {
        const next = {
          lat: result.coords.latitude,
          lng: result.coords.longitude,
          accuracyMeters: result.coords.accuracy,
          capturedAt: new Date().toISOString(),
        };
        setPosition(next);
        setLocating(false);
        // The route builder reads this store for its origin, so sharing here
        // means the built route starts where the driver actually is.
        writeStoredRouteStart({ ...storedStart, mode: "current" });
      },
      (error) => {
        setLocating(false);
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location was refused. The route will start from the shop."
            : "Could not get a location fix.",
        );
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    );
  }

  const selectedJob = todaysJobs.find((job) => job.id === selected);

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Today on the map</h2>
          <p className="text-sm text-ink-muted">
            {stops.length} of {todaysJobs.length}{" "}
            {todaysJobs.length === 1 ? "stop" : "stops"} placed
          </p>
        </div>
        <button
          type="button"
          onClick={shareLocation}
          disabled={locating}
          className="tap-target inline-flex items-center gap-2 rounded-control border border-line bg-raised px-4 text-sm font-semibold disabled:opacity-60"
        >
          {locating ? (
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
          ) : (
            <Crosshair className="h-4 w-4" aria-hidden />
          )}
          {position ? "Update my location" : "Show my location"}
        </button>
      </div>

      <JobMap
        apiKey={apiKey}
        stops={stops}
        currentPosition={position}
        drawRoute={stops.length > 1}
        onSelect={setSelected}
        className="h-[320px] sm:h-[440px]"
      />

      {locationError ? (
        <p className="mt-3 text-sm text-caution">{locationError}</p>
      ) : null}

      {selectedJob ? (
        <div className="mt-3 rounded-control border border-brand/30 bg-brand/[0.06] p-4">
          <p className="text-sm font-semibold">{selectedJob.customer}</p>
          <p className="mt-1 text-sm text-ink-muted">
            {selectedJob.time} · {selectedJob.address}, {selectedJob.city}
          </p>
        </div>
      ) : null}

      {missing.length > 0 ? (
        <div className="mt-3 flex items-start gap-2 rounded-control border border-caution/25 bg-caution-bg p-4 text-sm leading-6 text-caution">
          <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {missing.length} {missing.length === 1 ? "stop is" : "stops are"} not on the map
            because {missing.length === 1 ? "its address" : "their addresses"} could not be placed:{" "}
            {missing.map((job) => job.address).join(", ")}.
          </span>
        </div>
      ) : null}

      {unplaced.length > 0 ? (
        <div className="mt-3 rounded-control border border-caution/25 bg-caution-bg p-4 text-sm leading-6 text-caution">
          <p className="flex items-start gap-2 font-semibold">
            <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {unplaced.length === 1 ? "One address" : `${unplaced.length} addresses`} could not be
            placed
          </p>
          <ul className="mt-2 space-y-1">
            {unplaced.map((entry) => (
              <li key={entry.address}>
                <span className="font-medium">{entry.address}</span>
                <span className="block text-xs opacity-90">Google said: {entry.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}
