"use client";

import { useCallback, useState } from "react";

import { describeGeolocationError, type RouteStartPosition } from "@/lib/route-start";

export type GeolocationStatus = "idle" | "locating" | "ready" | "error";

/**
 * Shared GPS read for the route builder and the job detail page, so both report
 * the same statuses and the same refusal messages.
 */
export function useCurrentPosition() {
  const [position, setPosition] = useState<RouteStartPosition | undefined>();
  const [status, setStatus] = useState<GeolocationStatus>("idle");
  const [error, setError] = useState("");

  const request = useCallback((onResolved?: () => void) => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setStatus("error");
      setError("This browser cannot share a location. Type a start address instead.");
      return;
    }
    if (!window.isSecureContext) {
      setStatus("error");
      setError("Location needs a secure (https) connection. Type a start address instead.");
      return;
    }
    setStatus("locating");
    setError("");
    navigator.geolocation.getCurrentPosition(
      (result) => {
        setPosition({
          lat: result.coords.latitude,
          lng: result.coords.longitude,
          accuracyMeters: result.coords.accuracy,
          capturedAt: new Date().toISOString(),
        });
        setStatus("ready");
        onResolved?.();
      },
      (geolocationError) => {
        setStatus("error");
        setError(describeGeolocationError(geolocationError));
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, []);

  return { position, status, error, request };
}
