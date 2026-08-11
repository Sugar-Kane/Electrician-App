"use client";

import { useMemo, useState, useSyncExternalStore, type FormEvent } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronLeft,
  Crosshair,
  Home,
  MapPin,
  Navigation,
  RotateCcw,
  Route,
  Store,
  Undo2,
  X,
} from "lucide-react";

import { JobMap, type MapStop } from "@/components/job-map";
import { hasCoordinates } from "@/lib/coordinates";
import {
  buildAppleDirectionsUrl,
  buildGoogleDirectionsUrl,
  getPilotSupplyStore,
  serviceBase,
  type PilotJob,
  type SupplierId,
  type SupplyStore,
} from "@/lib/pilot-data";
import {
  moveStop,
  orderStops,
  routeSpan,
  spanInMiles,
  type RouteStopInput,
} from "@/lib/route-order";
import {
  buildRouteKey,
  getRouteProgressServerSnapshot,
  getRouteProgressSnapshot,
  resolveLegIndex,
  subscribeRouteProgress,
  writeRouteProgress,
} from "@/lib/route-progress";
import {
  cleanStartAddress,
  describeGeolocationError,
  formatAccuracy,
  formatCoordinates,
  getRouteStartServerSnapshot,
  getRouteStartSnapshot,
  maximumStartAddressLength,
  subscribeRouteStart,
  writeStoredRouteStart,
  type RouteStartMode,
  type RouteStartPosition,
} from "@/lib/route-start";

/**
 * The day's route, built on the map.
 *
 * There were two of these: a map that showed today's stops, and below it a
 * "route optimizer" that listed a different set of them. They disagreed, and
 * the list was the one that fed navigation.
 *
 * The list was also not what it claimed. It took `dayJobs.slice(0, 3)` in
 * booking order — so a four-job day quietly lost a job, and the "optimized"
 * order was the order the phone had rung in. The driving time and distance it
 * displayed, "2h 06m" and "78 mi", were constants typed into the markup.
 *
 * Now there is one route. The order is computed from the real coordinates, the
 * map draws it, the driver can move a stop or drop one, and the distance shown
 * is measured from the stops actually on it.
 */

type Stop = RouteStopInput & { job?: PilotJob };

const startModeOptions: { id: RouteStartMode; label: string; icon: typeof Home }[] = [
  { id: "base", label: "Shop", icon: Store },
  { id: "current", label: "My location", icon: Crosshair },
  { id: "custom", label: "Home address", icon: Home },
];

export function RouteBuilder({
  jobs,
  today,
  apiKey,
  unplaced,
  focusJobId,
  initialSupplier = "lowes",
  initialSupplyStore,
}: {
  jobs: PilotJob[];
  today: string;
  apiKey: string;
  /** Addresses the geocoder could not place, each with Google's own reason. */
  unplaced: { address: string; reason: string }[];
  focusJobId?: string;
  initialSupplier?: SupplierId;
  initialSupplyStore?: SupplyStore;
}) {
  const [built, setBuilt] = useState(false);
  const [supplier, setSupplier] = useState<SupplierId>(initialSupplier);
  const [selectedSupplyStore, setSelectedSupplyStore] = useState<SupplyStore | undefined>(
    initialSupplyStore,
  );
  const supplyStore =
    selectedSupplyStore?.supplier === supplier ? selectedSupplyStore : getPilotSupplyStore(supplier);

  const [skipped, setSkipped] = useState<string[]>([]);
  /** Hand-moved order. Null means "however the ordering came out". */
  const [manualOrder, setManualOrder] = useState<string[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);

  const storedStart = useSyncExternalStore(
    subscribeRouteStart,
    getRouteStartSnapshot,
    getRouteStartServerSnapshot,
  );
  const startMode = storedStart.mode;
  const savedStartAddress = storedStart.customAddress;

  const [addressDraft, setAddressDraft] = useState<string | undefined>();
  const startAddressDraft = addressDraft ?? savedStartAddress;
  const [position, setPosition] = useState<RouteStartPosition | undefined>();
  const [geoStatus, setGeoStatus] = useState<"idle" | "locating" | "ready" | "error">("idle");
  const [geoError, setGeoError] = useState("");

  function requestCurrentPosition() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setGeoStatus("error");
      setGeoError("This browser cannot share a location. Type a start address instead.");
      return;
    }
    if (!window.isSecureContext) {
      setGeoStatus("error");
      setGeoError("Location needs a secure (https) connection. Type a start address instead.");
      return;
    }
    setGeoStatus("locating");
    setGeoError("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({
          lat: result.coords.latitude,
          lng: result.coords.longitude,
          accuracyMeters: result.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
        setGeoStatus("ready");
        setBuilt(false);
        // A different origin is a different route, so a hand-made order from
        // the old one is no longer the driver's opinion about this one.
        setManualOrder(null);
      },
      (error) => {
        setGeoStatus("error");
        setGeoError(describeGeolocationError(error));
      },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 },
    );
  }

  function selectStartMode(mode: RouteStartMode) {
    writeStoredRouteStart({ mode, customAddress: savedStartAddress });
    setBuilt(false);
    setManualOrder(null);
    if (mode === "current" && !position && geoStatus !== "locating") requestCurrentPosition();
  }

  function saveStartAddress(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleaned = cleanStartAddress(startAddressDraft);
    writeStoredRouteStart({ mode: "custom", customAddress: cleaned });
    setAddressDraft(cleaned);
    setBuilt(false);
  }

  const startStop = useMemo<Stop>(() => {
    if (startMode === "current" && position) {
      return {
        id: "start-current",
        label: "My current location",
        address: formatCoordinates(position),
        detail: `Route start · GPS ${formatAccuracy(position.accuracyMeters)}`,
        kind: "base",
        point: { lat: position.lat, lng: position.lng },
      };
    }
    if (startMode === "custom" && savedStartAddress) {
      return {
        id: "start-custom",
        label: "Home address",
        address: savedStartAddress,
        detail: "Route start · saved on this device",
        kind: "base",
        // A typed address has never been geocoded, so the ordering falls back
        // to the shop's coordinates rather than pretending to know where it is.
        point: serviceBase.coordinates ?? null,
      };
    }
    return {
      id: "start-base",
      label: serviceBase.name,
      address: serviceBase.address,
      detail: "Route start · shop",
      kind: "base",
      point: serviceBase.coordinates ?? null,
    };
  }, [position, savedStartAddress, startMode]);

  const usingFallbackStart =
    (startMode === "current" && !position) || (startMode === "custom" && !savedStartAddress);

  /** Every job for the day — no cap. The old three-stop limit lost work. */
  const dayStops = useMemo<Stop[]>(() => {
    const dayWithWork =
      jobs.find((job) => job.date === today && job.status !== "Canceled")?.date ??
      jobs.find((job) => job.date >= today && job.status !== "Canceled")?.date ??
      today;

    const dayJobs = jobs.filter(
      (job) => job.date === dayWithWork && job.status !== "Canceled",
    );

    const supply: Stop = {
      id: supplyStore.id,
      label: supplyStore.name,
      address: supplyStore.address,
      detail: `Supply pickup${supplyStore.storeNumber ? ` · Store #${supplyStore.storeNumber}` : ""}`,
      kind: "supply",
      point: supplyStore.coordinates ?? null,
    };

    return [
      supply,
      ...dayJobs.map((job) => ({
        id: job.id,
        label: job.customer,
        address: `${job.address}, ${job.city}`,
        detail: `${job.time} · ${job.workType}`,
        kind: "job" as const,
        point: job.coordinates ?? null,
        job,
      })),
    ];
  }, [jobs, supplyStore, today]);

  const ordered = useMemo<Stop[]>(() => {
    const live = dayStops.map((stop) => ({ ...stop, skipped: skipped.includes(stop.id) }));
    const computed = orderStops({ origin: startStop.point, stops: live });

    if (!manualOrder) return computed;

    // The driver's order wins, but only over the stops that are still on the
    // route — a stop dropped after it was moved must not come back.
    const byId = new Map<string, Stop>(computed.map((stop) => [stop.id, stop]));
    const kept = manualOrder
      .map((id) => byId.get(id))
      .filter((stop): stop is Stop => stop !== undefined);
    const added = computed.filter((stop) => !manualOrder.includes(stop.id));
    return [...kept, ...added];
  }, [dayStops, manualOrder, skipped, startStop.point]);

  const routeStops = useMemo<Stop[]>(() => [startStop, ...ordered], [ordered, startStop]);

  const mapStops = useMemo<MapStop[]>(
    () =>
      routeStops
        .filter((stop) => hasCoordinates(stop.point))
        .map((stop, index) => ({
          id: stop.id,
          label: stop.label,
          sublabel: `${stop.detail} · ${stop.address}`,
          point: stop.point!,
          isStart: index === 0 && stop.kind === "base",
        })),
    [routeStops],
  );

  const miles = spanInMiles(routeSpan(startStop.point, ordered));
  const skippedStops = dayStops.filter((stop) => skipped.includes(stop.id));
  const unplaceable = ordered.filter((stop) => !hasCoordinates(stop.point));

  function move(id: string, delta: number) {
    setManualOrder(moveStop(ordered, id, delta).map((stop) => stop.id));
    setBuilt(false);
  }

  function toggleSkip(id: string) {
    setSkipped((current) =>
      current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id],
    );
    setBuilt(false);
  }

  const addresses = routeStops.map((stop) => stop.address);
  const googleUrl = buildGoogleDirectionsUrl(addresses);

  const routeKey = buildRouteKey(routeStops.slice(1).map((stop) => stop.id));
  const storedProgress = useSyncExternalStore(
    subscribeRouteProgress,
    getRouteProgressSnapshot,
    getRouteProgressServerSnapshot,
  );
  const legIndex = resolveLegIndex(storedProgress, routeKey, routeStops.length);
  const routeComplete = legIndex >= routeStops.length;
  const legOrigin = routeStops[legIndex - 1] ?? startStop;
  const legDestination = routeStops[legIndex];
  const appleUrl = buildAppleDirectionsUrl(
    legDestination?.address ?? startStop.address,
    legOrigin.address,
  );

  function goToLeg(nextLeg: number) {
    writeRouteProgress({ routeKey, legIndex: Math.min(Math.max(nextLeg, 1), routeStops.length) });
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[1.1fr_.9fr]">
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold tracking-tight">
              {built ? "Route built" : "Today on the map"}
            </h2>
            <p className="text-sm text-ink-muted">
              {ordered.length} {ordered.length === 1 ? "stop" : "stops"} ·{" "}
              {miles > 0 ? `about ${miles} mi in a straight line` : "distance unknown"}
            </p>
          </div>
        </div>

        <JobMap
          apiKey={apiKey}
          stops={mapStops}
          drawRoute={mapStops.length > 1}
          onSelect={setSelected}
          className="h-[320px] sm:h-[420px]"
        />

        <ol className="mt-4 space-y-2">
          {routeStops.map((stop, index) => {
            const done = built && index < legIndex;
            const current = built && index === legIndex;
            const isStart = index === 0;

            return (
              <li
                key={stop.id}
                className={`rounded-control border p-3 ${
                  current
                    ? "border-brand/60 bg-brand/[0.07]"
                    : selected === stop.id
                      ? "border-brand/40"
                      : "border-line"
                } ${done ? "opacity-60" : ""}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`grid h-9 w-9 shrink-0 place-items-center rounded-control border text-xs font-semibold ${
                      isStart
                        ? "border-line bg-white/5 text-ink-muted"
                        : "border-brand/40 bg-brand/10 text-brand"
                    }`}
                  >
                    {done ? <Check className="h-4 w-4" aria-hidden /> : isStart ? "•" : index}
                  </span>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{stop.label}</p>
                    <p className="mt-0.5 truncate text-xs text-ink-muted">{stop.detail}</p>
                    <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-ink-faint">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden />
                      {stop.address}
                    </p>
                    {!hasCoordinates(stop.point) && !isStart ? (
                      <p className="mt-1 text-xs text-caution">
                        Not on the map — this address could not be placed.
                      </p>
                    ) : null}
                    {stop.job ? (
                      <Link
                        href={`/jobs/${stop.job.id}`}
                        className="mt-1 inline-flex text-xs font-semibold text-brand"
                      >
                        Job #{stop.job.id}
                      </Link>
                    ) : null}
                  </div>

                  {!isStart ? (
                    <div className="flex shrink-0 flex-col gap-1">
                      <button
                        type="button"
                        onClick={() => move(stop.id, -1)}
                        disabled={index <= 1}
                        aria-label={`Move ${stop.label} earlier`}
                        className="grid h-8 w-8 place-items-center rounded-control border border-line text-ink-muted disabled:opacity-30"
                      >
                        <ArrowUp className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => move(stop.id, 1)}
                        disabled={index >= routeStops.length - 1}
                        aria-label={`Move ${stop.label} later`}
                        className="grid h-8 w-8 place-items-center rounded-control border border-line text-ink-muted disabled:opacity-30"
                      >
                        <ArrowDown className="h-3.5 w-3.5" aria-hidden />
                      </button>
                      <button
                        type="button"
                        onClick={() => toggleSkip(stop.id)}
                        aria-label={`Drop ${stop.label} from the route`}
                        className="grid h-8 w-8 place-items-center rounded-control border border-line text-ink-faint"
                      >
                        <X className="h-3.5 w-3.5" aria-hidden />
                      </button>
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>

        {skippedStops.length > 0 ? (
          <div className="mt-3 rounded-control border border-line p-3">
            <p className="text-xs font-semibold text-ink-muted">Dropped from this route</p>
            <ul className="mt-2 space-y-1.5">
              {skippedStops.map((stop) => (
                <li key={stop.id} className="flex items-center justify-between gap-2">
                  <span className="truncate text-xs text-ink-faint">{stop.label}</span>
                  <button
                    type="button"
                    onClick={() => toggleSkip(stop.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-brand"
                  >
                    <Undo2 className="h-3 w-3" aria-hidden />
                    Put back
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {unplaced.length > 0 ? (
          <div className="mt-3 rounded-control border border-caution/25 bg-caution-bg p-3 text-xs leading-5 text-caution">
            <p className="font-semibold">
              {unplaced.length === 1 ? "One address" : `${unplaced.length} addresses`} could not be
              placed
            </p>
            <ul className="mt-1.5 space-y-1">
              {unplaced.map((entry) => (
                <li key={entry.address}>
                  <span className="font-medium">{entry.address}</span>
                  <span className="block opacity-90">Google said: {entry.reason}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <div className="space-y-4">
        <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
          <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Start location
          </p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {startModeOptions.map((option) => {
              const active = startMode === option.id;
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => selectStartMode(option.id)}
                  aria-pressed={active}
                  className={`tap-target min-h-14 rounded-control border px-2 text-center ${
                    active
                      ? "border-brand/60 bg-brand/10 text-brand"
                      : "border-line bg-white/[0.025] text-ink-muted"
                  }`}
                >
                  <Icon className="mx-auto h-4 w-4" aria-hidden />
                  <span className="mt-1 block text-[11px] font-semibold leading-tight">
                    {option.label}
                  </span>
                </button>
              );
            })}
          </div>

          {startMode === "current" ? (
            <div className="mt-2 space-y-2">
              <button
                type="button"
                onClick={requestCurrentPosition}
                disabled={geoStatus === "locating"}
                className="tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line bg-white/[0.025] px-3 text-xs font-semibold disabled:opacity-60"
              >
                <Crosshair className="h-4 w-4" aria-hidden />
                {geoStatus === "locating"
                  ? "Locating…"
                  : position
                    ? "Refresh my location"
                    : "Use my current location"}
              </button>
              {position ? (
                <p className="rounded-control bg-positive-bg px-3 py-2 text-[11px] leading-4 text-positive">
                  Starting from {formatCoordinates(position)} · GPS{" "}
                  {formatAccuracy(position.accuracyMeters)}
                </p>
              ) : null}
              {geoStatus === "error" ? (
                <p role="status" className="rounded-control bg-critical-bg px-3 py-2 text-[11px] leading-4 text-critical">
                  {geoError}
                </p>
              ) : null}
            </div>
          ) : null}

          {startMode === "custom" ? (
            <form onSubmit={saveStartAddress} className="mt-2 space-y-2">
              <label htmlFor="route-start-address" className="sr-only">
                Home or start address
              </label>
              <input
                id="route-start-address"
                name="startAddress"
                type="text"
                autoComplete="street-address"
                maxLength={maximumStartAddressLength}
                value={startAddressDraft}
                onChange={(event) => setAddressDraft(event.target.value)}
                placeholder="123 Oak St, Nipomo, CA 93444"
                className="min-h-12 w-full rounded-control border border-line bg-raised px-3 text-sm placeholder:text-ink-faint"
              />
              <button
                type="submit"
                className="tap-target flex min-h-12 w-full items-center justify-center rounded-control border border-line bg-white/[0.025] px-3 text-xs font-semibold"
              >
                Save start address
              </button>
            </form>
          ) : null}

          {usingFallbackStart ? (
            <p className="mt-2 rounded-control bg-white/[0.04] px-3 py-2 text-[11px] leading-4 text-ink-faint">
              Using {serviceBase.name} as the start until a location is set.
            </p>
          ) : null}

          <p className="mt-4 text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
            Supply stop
          </p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {(["lowes", "home-depot"] as const).map((supplierId) => {
              const store = getPilotSupplyStore(supplierId);
              const active = supplier === supplierId;
              return (
                <button
                  key={supplierId}
                  type="button"
                  onClick={() => {
                    setSupplier(supplierId);
                    setSelectedSupplyStore(undefined);
                    setManualOrder(null);
                    setBuilt(false);
                  }}
                  aria-pressed={active}
                  className={`tap-target min-h-14 rounded-control border px-3 text-left ${
                    active
                      ? "border-brand/60 bg-brand/10 text-brand"
                      : "border-line bg-white/[0.025] text-ink-muted"
                  }`}
                >
                  <span className="block text-sm font-semibold">{store.shortName}</span>
                  <span className="mt-0.5 block text-[10px] opacity-70">
                    Store #{store.storeNumber}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {!built ? (
          <button
            type="button"
            onClick={() => setBuilt(true)}
            className="tap-target flex min-h-14 w-full items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand"
          >
            <Route className="h-5 w-5" aria-hidden />
            Lock this order and navigate
          </button>
        ) : (
          <section className="rounded-panel border border-brand/30 bg-surface p-4 sm:p-5">
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-brand">Route built</p>
            <p className="mt-2 text-sm leading-6 text-ink-muted">
              {ordered.length} {ordered.length === 1 ? "stop" : "stops"} from{" "}
              {startStop.label.toLowerCase()}
              {unplaceable.length > 0
                ? `, ${unplaceable.length} of which ${unplaceable.length === 1 ? "is" : "are"} not on the map.`
                : "."}{" "}
              Google receives the whole order. Apple Maps takes one destination at a time, so it
              runs the same route leg by leg.
            </p>

            <a
              href={googleUrl}
              target="_blank"
              rel="noreferrer"
              className="tap-target mt-4 flex min-h-13 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand"
            >
              <Navigation className="h-4 w-4" aria-hidden />
              Open full route in Google Maps
            </a>

            <div className="mt-5 border-t border-line pt-4">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold uppercase tracking-[0.1em] text-ink-faint">
                  Apple Maps · stop by stop
                </p>
                <p className="text-[10px] text-ink-faint">
                  Stop {Math.min(legIndex + 1, routeStops.length)} of {routeStops.length}
                </p>
              </div>

              {routeComplete || !legDestination ? (
                <div className="mt-3 space-y-2">
                  <p className="rounded-control bg-positive-bg px-3 py-2 text-[11px] leading-4 text-positive">
                    Every stop on this route has been navigated.
                  </p>
                  <button
                    type="button"
                    onClick={() => goToLeg(1)}
                    className="tap-target flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line px-4 text-xs font-semibold"
                  >
                    <RotateCcw className="h-4 w-4" aria-hidden />
                    Start the route over
                  </button>
                </div>
              ) : (
                <div className="mt-3 space-y-2">
                  <p className="text-sm font-semibold">{legDestination.label}</p>
                  <p className="text-[11px] text-ink-faint">{legDestination.address}</p>
                  <p className="text-[10px] text-ink-faint">Departing from {legOrigin.label}</p>
                  <a
                    href={appleUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="tap-target flex min-h-13 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
                  >
                    <Navigation className="h-4 w-4" aria-hidden />
                    Open stop {legIndex + 1} in Apple Maps
                  </a>
                  <div className="grid grid-cols-[auto_1fr] gap-2">
                    <button
                      type="button"
                      onClick={() => goToLeg(legIndex - 1)}
                      disabled={legIndex <= 1}
                      className="tap-target flex min-h-12 items-center justify-center rounded-control border border-line px-3 text-xs font-semibold disabled:opacity-40"
                    >
                      <ChevronLeft className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Previous stop</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => goToLeg(legIndex + 1)}
                      className="tap-target flex min-h-12 items-center justify-center gap-2 rounded-control border border-positive/30 bg-positive-bg px-4 text-xs font-semibold text-positive"
                    >
                      <Check className="h-4 w-4" aria-hidden />
                      Arrived · next stop
                    </button>
                  </div>
                </div>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
