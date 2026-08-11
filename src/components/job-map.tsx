"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MapPin, TriangleAlert } from "lucide-react";

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

function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  // Map is the thing actually needed; `google.maps` alone proves only that the
  // bootstrap ran, which was the whole bug.
  if (window.google?.maps?.Map) return Promise.resolve();

  window.__volteiraMapsPromise ??= (async () => {
    await new Promise<void>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>("script[data-volteira-maps]");
      if (existing) {
        existing.addEventListener("load", () => resolve());
        existing.addEventListener("error", () => reject(new Error("Google Maps failed to load.")));
        return;
      }

      const script = document.createElement("script");
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&loading=async`;
      script.async = true;
      script.dataset.volteiraMaps = "true";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Google Maps failed to load."));
      document.head.appendChild(script);
    });

    const bootstrap = window.google?.maps as (typeof window.google.maps & Bootstrap) | undefined;

    // Older loaders hand over a fully populated namespace and have no
    // importLibrary at all. Nothing to wait for in that case.
    if (typeof bootstrap?.importLibrary !== "function") return;

    await bootstrap.importLibrary("maps");
    await bootstrap.importLibrary("marker");
  })();

  return window.__volteiraMapsPromise;
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

  useEffect(() => {
    if (!apiKey) return;
    return subscribeToAuthFailure(() => setStatus("refused"));
  }, [apiKey]);

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

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
      .catch(() => {
        if (!cancelled) setStatus("failed");
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey]);

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
        className={`grid place-items-center rounded-control border border-line bg-raised p-6 text-center ${className}`}
      >
        <div className="max-w-sm">
          <MapPin className="mx-auto h-6 w-6 text-ink-faint" aria-hidden />
          <p className="mt-3 text-sm font-semibold">The map is not switched on yet</p>
          <p className="mt-1 text-sm leading-6 text-ink-muted">
            Set <code className="text-brand">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code> to show the
            route on a map. The stop order below works without it.
          </p>
        </div>
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

      {status === "failed" || status === "refused" ? (
        <div className="absolute inset-0 grid place-items-center bg-raised p-6 text-center">
          <div className="max-w-sm">
            <TriangleAlert className="mx-auto h-6 w-6 text-caution" aria-hidden />
            <p className="mt-3 text-sm font-semibold">
              {status === "refused" ? "Google refused this map key" : "The map could not load"}
            </p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              {status === "refused" ? (
                <>
                  The key reached Google and was turned down — usually because it is restricted to
                  a different website, or because Maps JavaScript API is not enabled on its
                  project. Geocoding-only keys are refused here too.
                </>
              ) : (
                <>
                  The request for Google&rsquo;s map script never completed. That is a network
                  problem, a blocked request, or a key so malformed Google would not serve it.
                </>
              )}
            </p>
            <p className="mt-2 text-xs text-ink-faint">
              Key in use ends {keyTail(apiKey)} · from{" "}
              <code className="text-brand">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>, compiled at
              build time, so changing it needs a redeploy.
            </p>
            <p className="mt-2 text-xs text-ink-faint">The stop order below still works.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Dark tiles, so the map belongs to the app rather than interrupting it. */
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
