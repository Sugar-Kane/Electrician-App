export type RouteStartMode = "base" | "current" | "custom";

export type StoredRouteStart = {
  mode: RouteStartMode;
  customAddress: string;
};

export type RouteStartPosition = {
  lat: number;
  lng: number;
  accuracyMeters: number;
  capturedAt: string;
};

export const routeStartStorageKey = "volteira:route-start:v1";

export const maximumStartAddressLength = 240;

export const routeStartModeLabels: Record<RouteStartMode, string> = {
  base: "Shop",
  current: "Current location",
  custom: "Home address",
};

export function isRouteStartMode(value: unknown): value is RouteStartMode {
  return value === "base" || value === "current" || value === "custom";
}

/**
 * Trims the free-text start address the same way the route page cleans query
 * values, so a pasted address with control characters cannot reach a map link.
 */
export function cleanStartAddress(value: string) {
  return value
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maximumStartAddressLength);
}

const defaultRouteStart: StoredRouteStart = { mode: "base", customAddress: "" };

function parseRouteStart(raw: string | null): StoredRouteStart {
  if (!raw) return defaultRouteStart;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultRouteStart;
    const candidate = parsed as Partial<StoredRouteStart>;
    return {
      mode: isRouteStartMode(candidate.mode) ? candidate.mode : "base",
      customAddress: typeof candidate.customAddress === "string" ? cleanStartAddress(candidate.customAddress) : "",
    };
  } catch {
    return defaultRouteStart;
  }
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue = defaultRouteStart;

export function subscribeRouteStart(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/**
 * Must return a referentially stable value between changes, so the parsed object
 * is cached against the raw string `useSyncExternalStore` last saw.
 */
export function getRouteStartSnapshot(): StoredRouteStart {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(routeStartStorageKey);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseRouteStart(raw);
  }
  return cachedValue;
}

/** The server has no storage, so it always renders the shop as the start. */
export function getRouteStartServerSnapshot(): StoredRouteStart {
  return defaultRouteStart;
}

export function writeStoredRouteStart(value: StoredRouteStart) {
  try {
    window.localStorage.setItem(routeStartStorageKey, JSON.stringify(value));
  } catch {
    // Private browsing modes can reject writes; the route still works in-session.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Google and Apple map links both accept a bare "lat,lng" pair as an origin, so
 * a GPS start needs no geocoding round trip.
 */
export function formatCoordinates(position: { lat: number; lng: number }) {
  return `${position.lat.toFixed(6)},${position.lng.toFixed(6)}`;
}

export function formatAccuracy(accuracyMeters: number) {
  const feet = Math.round(accuracyMeters * 3.28084);
  return feet >= 1000 ? `±${(feet / 5280).toFixed(1)} mi` : `±${feet} ft`;
}

export function describeGeolocationError(error: unknown) {
  const code = typeof error === "object" && error !== null ? (error as GeolocationPositionError).code : undefined;
  if (code === 1) return "Location permission is off. Allow it in your browser settings, or type a start address instead.";
  if (code === 2) return "Your device could not get a GPS fix. Try again outdoors, or type a start address instead.";
  if (code === 3) return "Locating timed out. Try again, or type a start address instead.";
  return "Could not read your location. Type a start address instead.";
}
