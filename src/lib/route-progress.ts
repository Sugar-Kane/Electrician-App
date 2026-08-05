export type StoredRouteProgress = {
  /** Fingerprint of the stop list the index belongs to. */
  routeKey: string;
  /** Index into the stop list of the stop being navigated to. */
  legIndex: number;
};

export const routeProgressStorageKey = "volteira:route-progress:v1";

const defaultRouteProgress: StoredRouteProgress = { routeKey: "", legIndex: 1 };

/**
 * Progress is only meaningful against the stop list it was recorded on, so the
 * stored index is discarded whenever the route is rebuilt differently.
 */
export function buildRouteKey(stopIds: string[]) {
  return stopIds.join(">");
}

function parseRouteProgress(raw: string | null): StoredRouteProgress {
  if (!raw) return defaultRouteProgress;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultRouteProgress;
    const candidate = parsed as Partial<StoredRouteProgress>;
    if (typeof candidate.routeKey !== "string" || typeof candidate.legIndex !== "number") return defaultRouteProgress;
    if (!Number.isInteger(candidate.legIndex) || candidate.legIndex < 1) return defaultRouteProgress;
    return { routeKey: candidate.routeKey, legIndex: candidate.legIndex };
  } catch {
    return defaultRouteProgress;
  }
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedValue = defaultRouteProgress;

export function subscribeRouteProgress(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

export function getRouteProgressSnapshot(): StoredRouteProgress {
  let raw: string | null = null;
  try {
    raw = window.sessionStorage.getItem(routeProgressStorageKey);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedValue = parseRouteProgress(raw);
  }
  return cachedValue;
}

export function getRouteProgressServerSnapshot(): StoredRouteProgress {
  return defaultRouteProgress;
}

export function writeRouteProgress(value: StoredRouteProgress) {
  try {
    window.sessionStorage.setItem(routeProgressStorageKey, JSON.stringify(value));
  } catch {
    // Private browsing modes can reject writes; progress still works in-session.
  }
  listeners.forEach((listener) => listener());
}

/**
 * Clamps stored progress to the current route. `stopCount` counts every stop
 * including the start, so a leg index equal to `stopCount` means "finished".
 */
export function resolveLegIndex(stored: StoredRouteProgress, routeKey: string, stopCount: number) {
  if (stored.routeKey !== routeKey) return 1;
  return Math.min(Math.max(stored.legIndex, 1), stopCount);
}
