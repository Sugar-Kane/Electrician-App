"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MapPin, TriangleAlert } from "lucide-react";

import type { Coordinates } from "@/lib/coordinates";

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
  }
}

/** One shared load, however many maps a page ends up rendering. */
function loadMaps(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.google?.maps) return Promise.resolve();

  window.__volteiraMapsPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&libraries=marker&loading=async`;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("Google Maps failed to load."));
    document.head.appendChild(script);
  });

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
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    if (!apiKey) return;
    let cancelled = false;

    loadMaps(apiKey)
      .then(() => {
        if (cancelled || !container.current || !window.google?.maps) return;
        mapRef.current ??= new window.google.maps.Map(container.current, {
          center: { lat: 35.0428, lng: -120.4766 },
          zoom: 11,
          disableDefaultUI: true,
          zoomControl: true,
          // A map inside a dark app that is bright white is the thing people
          // notice first, and the only part of this that is purely cosmetic.
          styles: DARK_MAP_STYLE,
        });
        setStatus("ready");
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

      {status === "failed" ? (
        <div className="absolute inset-0 grid place-items-center bg-raised p-6 text-center">
          <div className="max-w-sm">
            <TriangleAlert className="mx-auto h-6 w-6 text-caution" aria-hidden />
            <p className="mt-3 text-sm font-semibold">The map could not load</p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              Usually the API key is restricted to different domains, or Maps JavaScript API is
              not enabled on the project. The stop order below still works.
            </p>
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
