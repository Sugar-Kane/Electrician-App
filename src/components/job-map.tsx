"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MapPin, RefreshCw, TriangleAlert } from "lucide-react";

import type { Coordinates } from "@/lib/coordinates";
import { keyTail } from "@/lib/map-key";

/**
 * A real map, with the day's stops on it.
 *
 * Loaded on demand rather than in the page bundle: the Maps JavaScript API is
 * several hundred kilobytes and most screens in this app never show a map, so
 * an electrician on a phone in a van should not pay for it on every page.
 *
 * Without a key it renders an explanation rather than an empty grey box. That
 * is the state this will actually be in until somebody sets one, and a blank
 * rectangle with no reason given is the least debuggable thing to ship.
 */

export type MapStop = {
  id: string;
  label: string;
  sublabel: string;
  point: Coordinates;
  /** Draws it as the start rather than a numbered stop. */
  isStart?: boolean;
};

declare global {
  interface Window {
    google?: typeof google;
    __volteiraMapsPromise?: Promise<void>;
    /**
     * Google calls this when it refuses the key. It is the only programmatic
     * notice of an auth failure — see `subscribeToAuthFailure`.
     */
    gm_authFailure?: () => void;
  }
}

/**
 * Google's key rejections do not fail the script request.
 *
 * A wrong-API, wrong-referrer, or revoked key still returns a perfectly good
 * 200 from `maps/api/js`. The script loads, the map object constructs, and then
 * Google quietly paints a grey "for development purposes only" rectangle and
 * writes the real reason to the console — which nobody operating this app is
 * going to open. The one hook it offers is `window.gm_authFailure`, so we take
 * it and turn it into something on the screen.
 */
const authFailureListeners = new Set<() => void>();
let authFailed = false;

function subscribeToAuthFailure(listener: () => void): () => void {
  if (typeof window !== "undefined") {
    window.gm_authFailure ??= () => {
      // The screen shows a symbol and a Refresh button now, so this is the
      // only place the reason survives. It is the commonest real cause: a key
      // restricted to another site, or Maps JavaScript API not enabled on its
      // project. A geocoding-only key is refused here too.
      console.error(
        "[volteira] Google refused the Maps key. Check the key's website restrictions " +
          "and that Maps JavaScript API is enabled on its project.",
      );
      authFailed = true;
      for (const notify of authFailureListeners) notify();
    };
  }
  authFailureListeners.add(listener);
  // A failure can land before a second map mounts; replay it rather than
  // leaving that map spinning forever.
  if (authFailed) listener();
  return () => authFailureListeners.delete(listener);
}

/**
 * One shared load, however many maps a page ends up rendering.
 *
 * `loading=async` does not deliver the Maps API. It delivers a *bootstrap* that
 * defines `google.maps.importLibrary` and fetches the real libraries on demand.
 * So at `script.onload` the object `window.google.maps` exists while
 * `google.maps.Map` does not yet — and constructing a map right then throws a
 * TypeError that looks, from the outside, exactly like a rejected API key.
 *
 * This cost an afternoon of rotating Google credentials that were never the
 * problem. The script has to be awaited and then the libraries asked for by
 * name, which is what `importLibrary` is for.
 */
type Bootstrap = {
  importLibrary?: (name: string) => Promise<unknown>;
};

/**
 * A load that takes longer than this is not going to finish.
 *
 * Twenty-five seconds rather than fifteen. This runs on a phone on mobile data
 * in a van, where the Maps bootstrap and its two libraries are a slow fetch and
 * not a broken one — and a timeout that fires on a slow connection is
 * indistinguishable, to the person holding it, from a map that does not work.
 */
const LOAD_TIMEOUT_MS = 25_000;

/**
 * How many times to try again before showing anything.
 *
 * A dropped request on a moving vehicle is the ordinary case, not the
 * exceptional one, and it usually succeeds a second later. Retrying silently
 * is what the Refresh button was doing by hand.
 */
const AUTO_RETRIES = 2;
const RETRY_DELAYS_MS = [1_500, 4_000];

function awaitScript(apiKey: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>("script[data-volteira-maps]");

    if (existing) {
      // An already-finished script fires neither event ever again. Listening
      // for one left the promise pending forever and the spinner turning —
      // which is why a second mount after a reload could hang rather than
      // recover.
      if (existing.dataset.state === "loaded") {
        resolve();
        return;
      }
      if (existing.dataset.state === "error") {
        reject(new Error("Google Maps failed to load."));
        return;
      }

      existing.addEventListener("load", () => resolve(), { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Google Maps failed to load.")),
        { once: true },
      );
      return;
    }

    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&loading=async`;
    script.async = true;
    script.dataset.volteiraMaps = "true";
    script.dataset.state = "loading";
    script.onload = () => {
      script.dataset.state = "loaded";
      resolve();
    };
    script.onerror = () => {
      // Removed as well as marked. A dead script element left in the head is
      // what a retry would otherwise find and immediately give up on.
      script.dataset.state = "error";
      script.remove();
      reject(new Error("Google Maps failed to load."));
    };
    document.head.appendChild(script);
  });
}

function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // Map is the thing actually needed; `google.maps` alone proves only that the
  // bootstrap ran, which was the whole bug.
  if (window.google?.maps?.Map) return Promise.resolve();

  window.__volteiraMapsPromise ??= (async () => {
    // A load that never settles is indistinguishable from a slow one, and the
    // spinner sits there either way.
    await Promise.race([
      awaitScript(apiKey),
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () => reject(new Error("Google Maps did not load in time.")),
          LOAD_TIMEOUT_MS,
        ),
      ),
    ]);

    const bootstrap = window.google?.maps as (typeof window.google.maps & Bootstrap) | undefined;

    // Older loaders hand over a fully populated namespace and have no
    // importLibrary at all. Nothing to wait for in that case.
    if (typeof bootstrap?.importLibrary !== "function") return;

    await bootstrap.importLibrary("maps");
    await bootstrap.importLibrary("marker");
  })();

  // A rejected promise cached on `window` is permanent for the life of the
  // page: every later mount awaits the same failure and reports it again, so
  // one bad load turns into a map that can never recover without a reload.
  // Clearing it means the next attempt actually attempts something.
  return window.__volteiraMapsPromise.catch((reason: unknown) => {
    window.__volteiraMapsPromise = undefined;
    throw reason;
  });
}

export function JobMap({
  apiKey,
  stops,
  currentPosition,
  drawRoute = false,
  className = "h-[420px]",
  onSelect,
}: {
  apiKey: string;
  stops: MapStop[];
  /** The driver, if they have shared their location. */
  currentPosition?: Coordinates;
  /** Joins the stops in order, for a route that has been built. */
  drawRoute?: boolean;
  className?: string;
  onSelect?: (id: string) => void;
}) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const drawn = useRef<{ markers: google.maps.Marker[]; line: google.maps.Polyline | null }>({
    markers: [],
    line: null,
  });
  const [status, setStatus] = useState<"loading" | "ready" | "failed" | "refused">("loading");
  /** Bumped to run the load effect again, by the retry timer or the button. */
  const [attempt, setAttempt] = useState(0);
  /** Automatic attempts already spent. Reset by a press of Refresh. */
  const autoRetries = useRef(0);
  /** Cleared on unmount, so a retry cannot fire into a component that is gone. */
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!apiKey) return;
    return subscribeToAuthFailure(() => setStatus("refused"));
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    /*
     * Going back to the spinner belongs to whatever asked for the retry, not
     * here. Both callers below do it, which is one line in each and a render
     * saved undoing itself — and the reset now happens with the action that
     * caused it rather than one render later.
     */
    loadMaps(apiKey)
      .then(() => {
        if (cancelled || !container.current) return;
        // Returning quietly here used to leave the spinner turning forever,
        // which is the one outcome that tells nobody anything.
        if (!window.google?.maps?.Map) {
          setStatus("failed");
          return;
        }
        mapRef.current ??= new window.google.maps.Map(container.current, {
          center: { lat: 35.0428, lng: -120.4766 },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          // A map inside a dark app that is bright white is the thing people
          // notice first, and the only part of this that is purely cosmetic.
          styles: DARK_MAP_STYLE,
        });
        // A key rejection can arrive before the constructor returns; do not
        // paint over it with "ready".
        setStatus((current) => (current === "refused" ? current : "ready"));
      })
      .catch((reason: unknown) => {
        if (cancelled) return;

        // A refused key is refused every time. Retrying it is pointless, and
        // reporting it as a failed request sends whoever reads this looking at
        // the network when the answer is in the Google console.
        if (authFailed) {
          setStatus("refused");
          return;
        }

        // A dropped request in a moving vehicle is ordinary. Try again quietly
        // before putting anything on the screen — this is what pressing
        // Refresh was doing, and it does not need a person to do it.
        if (autoRetries.current < AUTO_RETRIES) {
          const wait = RETRY_DELAYS_MS[autoRetries.current] ?? 4_000;
          autoRetries.current += 1;
          retryTimer.current = setTimeout(() => {
            setStatus(backToLoading);
            setAttempt((n) => n + 1);
          }, wait);
          return;
        }

        // The screen no longer explains itself — it shows a symbol and a
        // Refresh button, because none of the detail was actionable by an
        // electrician in a driveway. It still has to go somewhere, so it goes
        // here, with the key tail that used to be printed on the map.
        console.error(
          `[volteira] Google Maps failed to load after ${AUTO_RETRIES + 1} attempts. ` +
            `Key ends ${keyTail(apiKey)}. NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is compiled at ` +
            "build time, so changing it needs a redeploy.",
          reason,
        );
        setStatus("failed");
      });

    return () => {
      cancelled = true;
      if (retryTimer.current) {
        clearTimeout(retryTimer.current);
        retryTimer.current = null;
      }
    };
  }, [apiKey, attempt]);

  useEffect(() => {
    const map = mapRef.current;
    if (status !== "ready" || !map || !window.google?.maps) return;

    for (const marker of drawn.current.markers) marker.setMap(null);
    drawn.current.line?.setMap(null);
    drawn.current = { markers: [], line: null };

    const bounds = new window.google.maps.LatLngBounds();
    let plotted = 0;

    stops.forEach((stop, index) => {
      const marker = new window.google.maps.Marker({
        map,
        position: stop.point,
        title: `${stop.label} — ${stop.sublabel}`,
        label: stop.isStart
          ? undefined
          : { text: String(index + (stops[0]?.isStart ? 0 : 1)), color: "#071723", fontWeight: "700" },
        icon: stop.isStart
          ? {
              path: window.google.maps.SymbolPath.CIRCLE,
              scale: 8,
              fillColor: "#60a5fa",
              fillOpacity: 1,
              strokeColor: "#0b1b27",
              strokeWeight: 3,
            }
          : undefined,
      });

      if (onSelect) marker.addListener("click", () => onSelect(stop.id));
      drawn.current.markers.push(marker);
      bounds.extend(stop.point);
      plotted += 1;
    });

    if (currentPosition) {
      const you = new window.google.maps.Marker({
        map,
        position: currentPosition,
        title: "You",
        icon: {
          path: window.google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: "#34d399",
          fillOpacity: 1,
          strokeColor: "#06131d",
          strokeWeight: 3,
        },
      });
      drawn.current.markers.push(you);
      bounds.extend(currentPosition);
      plotted += 1;
    }

    if (drawRoute && stops.length > 1) {
      drawn.current.line = new window.google.maps.Polyline({
        map,
        path: stops.map((stop) => stop.point),
        strokeColor: "#ffc21c",
        strokeOpacity: 0.9,
        strokeWeight: 4,
      });
    }

    if (plotted === 1) {
      map.setCenter(bounds.getCenter());
      map.setZoom(14);
    } else if (plotted > 1) {
      map.fitBounds(bounds, 48);
    }
  }, [status, stops, currentPosition, drawRoute, onSelect]);

  if (!apiKey) {
    return (
      <div
        className={`grid place-items-center rounded-control border border-line bg-raised p-4 ${className}`}
        role="img"
        aria-label="The map is not switched on for this business."
      >
        <MapPin className="h-6 w-6 text-ink-faint" aria-hidden />
      </div>
    );
  }

  return (
    <div className={`relative overflow-hidden rounded-control border border-line ${className}`}>
      <div ref={container} className="h-full w-full" />

      {status === "loading" ? (
        <div className="absolute inset-0 grid place-items-center bg-raised">
          <LoaderCircle className="h-6 w-6 animate-spin text-ink-faint" aria-hidden />
          <span className="sr-only">Loading the map</span>
        </div>
      ) : null}

      {/*
        A failed map says so with a symbol and a button, and nothing else.

        It used to explain itself at length — which request failed, which key
        was in use, that the variable is compiled at build time and needs a
        redeploy. All true, all written for whoever was debugging it, and all
        of it addressed to an electrician standing in a driveway who cannot act
        on any of it. The stop list below the map keeps working either way, so
        the map failing is an inconvenience, not an incident.

        The reason is still available to anyone who needs it: it goes to the
        console, and the screen reader gets it through the button's label.
      */}
      {status === "failed" || status === "refused" ? (
        <div className="absolute inset-0 grid place-items-center bg-raised p-4">
          <div className="flex flex-col items-center gap-3">
            <TriangleAlert className="h-6 w-6 text-caution" aria-hidden />
            <button
              type="button"
              onClick={() => {
                autoRetries.current = 0;
                setStatus(backToLoading);
                setAttempt((current) => current + 1);
              }}
              aria-label={
                status === "refused"
                  ? "The map key was refused by Google. Refresh the map"
                  : "The map could not load. Refresh it"
              }
              className="tap-target inline-flex min-h-11 items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
            >
              <RefreshCw className="h-4 w-4" aria-hidden />
              Refresh
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Dark tiles, so the map belongs to the app rather than interrupting it.
 *
 * Literal hex on purpose. Google's styling API takes colour values, not CSS,
 * so these cannot be theme tokens — they are the same values as --color-surface
 * and --color-canvas and have to be changed alongside them.
 */
/**
 * Back to the spinner for another attempt.
 *
 * Guarded exactly as it was when it lived in the effect: a map already drawn
 * must not flicker back to a spinner because a retry was queued behind it.
 *
 * `refused` is deliberately not preserved. Pressing Refresh on a rejected key
 * is a real attempt and has to look like one — the auto-retry never reaches
 * here while refused, because it gives up before scheduling.
 */
function backToLoading(current: "loading" | "ready" | "failed" | "refused") {
  return current === "ready" ? current : "loading";
}

const DARK_MAP_STYLE: google.maps.MapTypeStyle[] = [
  { elementType: "geometry", stylers: [{ color: "#0b1b27" }] },
  { elementType: "labels.text.stroke", stylers: [{ color: "#0b1b27" }] },
  { elementType: "labels.text.fill", stylers: [{ color: "#94a3b8" }] },
  { featureType: "poi", stylers: [{ visibility: "off" }] },
  { featureType: "transit", stylers: [{ visibility: "off" }] },
  { featureType: "road", elementType: "geometry", stylers: [{ color: "#13293a" }] },
  { featureType: "road", elementType: "labels.text.fill", stylers: [{ color: "#64748b" }] },
  { featureType: "road.highway", elementType: "geometry", stylers: [{ color: "#1b3a52" }] },
  { featureType: "water", elementType: "geometry", stylers: [{ color: "#06131d" }] },
  { featureType: "administrative", elementType: "geometry.stroke", stylers: [{ color: "#1f3446" }] },
];
