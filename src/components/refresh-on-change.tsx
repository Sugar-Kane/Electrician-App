"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type Options = {
  /** How often to ask while the screen is in view, in milliseconds. */
  every: number;
  /** Stop asking for now, e.g. while this screen's own write is in flight. */
  paused?: boolean;
};

/**
 * Keeps a server-rendered screen current without anybody reloading it.
 *
 * The page is rendered with a fingerprint of what it shows. While the screen is
 * in view, this asks `source` for the fingerprint as it stands now — every
 * `every` milliseconds, and straight away when the screen comes back into view
 * or back online — and refreshes the route only when the two differ.
 *
 * Asking first, rather than refreshing on a timer, is not only about cost. When
 * a refresh cannot reach the server, Next gives up on it and loads the whole
 * page instead, which on a phone with no signal is the browser's offline screen
 * and the end of whatever reply was half typed. A question that fails costs
 * nothing and is asked again, and a refresh is only ever attempted straight
 * after a question got through.
 */
export function useRefreshOnChange(
  source: string,
  fingerprint: string,
  { every, paused = false }: Options,
) {
  const router = useRouter();

  useEffect(() => {
    if (paused) return;

    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let request: AbortController | undefined;
    // One refresh per new state of the server. Should a refresh ever come back
    // without the change, this keeps it from being retried every few seconds
    // for as long as the screen is open; the next real change gets its own.
    let requested: string | null = null;

    const later = () => {
      clearTimeout(timer);
      if (!stopped) timer = setTimeout(check, every);
    };

    async function check() {
      clearTimeout(timer);
      // Nothing to keep current while nobody can see it. Coming back into view
      // asks at once.
      if (document.visibilityState === "hidden") return;
      if (!navigator.onLine) return later();

      request?.abort();
      request = new AbortController();
      try {
        const response = await fetch(source, { cache: "no-store", signal: request.signal });
        const latest: unknown = response.ok ? (await response.json()).fingerprint : null;
        if (!stopped && typeof latest === "string" && latest !== fingerprint && latest !== requested) {
          requested = latest;
          router.refresh();
        }
      } catch {
        // Offline, aborted, or signed out: keep what is on screen and ask again.
      }
      later();
    }

    const resume = () => {
      if (document.visibilityState === "visible") void check();
    };

    document.addEventListener("visibilitychange", resume);
    window.addEventListener("online", resume);
    // Straight away as well: a page shown from the router's cache can already
    // be twenty seconds old by the time this runs.
    void check();

    return () => {
      stopped = true;
      clearTimeout(timer);
      request?.abort();
      document.removeEventListener("visibilitychange", resume);
      window.removeEventListener("online", resume);
    };
  }, [source, fingerprint, every, paused, router]);
}

/** The same, for a server-rendered page with no client component to put it in. */
export function RefreshOnChange({
  source,
  fingerprint,
  every,
}: {
  source: string;
  fingerprint: string;
  every: number;
}) {
  useRefreshOnChange(source, fingerprint, { every });
  return null;
}
