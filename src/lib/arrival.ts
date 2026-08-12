/**
 * Noticing that somebody has got there, without watching them get there.
 *
 * A technician standing at a customer's door has both hands full and no reason
 * to tell an app something it can work out. So the app works it out: a circle
 * around the property, and a wait long enough that driving past it is not
 * arriving at it.
 *
 * The dwell timer is the whole design. Without it, a geofence fires at the
 * moment of crossing — which happens at the end of the street, at the
 * neighbour's, and again on the way to the next job. With it, arrival means
 * "was near this house and stayed near it", which is what arriving is.
 *
 * Import-free apart from the coordinate guard, so the arithmetic can be tested
 * at the distances and accuracies it actually breaks at. That one import is
 * written as an explicit `.ts` path because node runs these tests by stripping
 * types, which resolves real files and not the `@/` alias.
 */

import { hasCoordinates, type Coordinates } from "./coordinates.ts";

export type { Coordinates };

/**
 * About 400 feet. Far enough to cover a long driveway and a detached garage,
 * near enough that the house across the road is outside it.
 */
export const DEFAULT_ARRIVAL_RADIUS_METERS = 120;

/**
 * The range a business may set it to: roughly 130 feet to a mile.
 *
 * The floor exists because a radius smaller than a good GPS fix can never be
 * satisfied, and an arrival that cannot happen is worse than one that is
 * approximate. The ceiling is for ranches and industrial parks, where the gate
 * and the panel are a long way apart.
 */
export const MINIMUM_ARRIVAL_RADIUS_METERS = 40;
export const MAXIMUM_ARRIVAL_RADIUS_METERS = 1600;

/**
 * How long inside the circle counts as being there.
 *
 * Forty-five seconds is a compromise between the two failures. Shorter, and a
 * red light at the end of the street marks somebody arrived and texts the
 * customer. Longer, and an electrician who has already knocked is still holding
 * a phone that says "on my way".
 */
export const ARRIVAL_DWELL_SECONDS = 45;

export type ArrivalReading = {
  coordinates: Coordinates;
  /** The browser's own estimate, in metres, of how wrong it might be. */
  accuracyMeters: number;
  /** Epoch milliseconds. Passed in rather than read, so this stays testable. */
  atMs: number;
};

/** What is carried between readings: when the technician got inside, if they are. */
export type ArrivalWatchState = { insideSinceMs: number | null };

export const IDLE_WATCH: ArrivalWatchState = { insideSinceMs: null };

export type ArrivalPhase = "outside" | "settling" | "arrived" | "unusable";

export type ArrivalEvaluation = {
  next: ArrivalWatchState;
  arrived: boolean;
  phase: ArrivalPhase;
  /** Null when the reading could not be compared to anything. */
  distanceMeters: number | null;
  /** Counts down while settling, 0 otherwise. */
  secondsRemaining: number;
};

const EARTH_RADIUS_METRES = 6_371_008.8;

function toRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

/**
 * Great-circle distance between two points, in metres.
 *
 * Haversine rather than a flat approximation: the error of pretending the earth
 * is a plane is small at these distances, and "small" is not a word worth using
 * about the thing that decides whether a customer is told their electrician has
 * turned up.
 */
export function distanceMeters(from: Coordinates, to: Coordinates): number {
  const deltaLat = toRadians(to.lat - from.lat);
  const deltaLng = toRadians(to.lng - from.lng);
  const fromLat = toRadians(from.lat);
  const toLat = toRadians(to.lat);

  const a =
    Math.sin(deltaLat / 2) ** 2 +
    Math.cos(fromLat) * Math.cos(toLat) * Math.sin(deltaLng / 2) ** 2;

  return 2 * EARTH_RADIUS_METRES * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** A stored radius, kept inside what the geofence can actually honour. */
export function arrivalRadiusMeters(value: unknown): number {
  const parsed = typeof value === "string" ? Number(value) : value;
  if (typeof parsed !== "number" || !Number.isFinite(parsed)) {
    return DEFAULT_ARRIVAL_RADIUS_METERS;
  }
  return Math.min(
    MAXIMUM_ARRIVAL_RADIUS_METERS,
    Math.max(MINIMUM_ARRIVAL_RADIUS_METERS, Math.round(parsed)),
  );
}

/**
 * One location reading, judged.
 *
 * Inside means the whole uncertainty circle is inside the geofence — the fix
 * plus everything the browser admits it might be wrong by. That is stricter
 * than comparing the distance alone, and deliberately so: the expensive mistake
 * here is not a late arrival, it is texting a customer that their electrician
 * has arrived while they are still two streets away. Being slow costs one tap
 * on Mark arrived; being wrong costs somebody standing at their front door.
 *
 * A reading too vague to satisfy that test at all — accuracy wider than the
 * whole geofence, which is what a phone reports indoors or in a canyon —
 * neither starts the timer nor cancels one already running. Half a minute of
 * bad signal while parked outside the house should not throw away the wait.
 */
export function evaluateArrival(input: {
  reading: ArrivalReading;
  target: Coordinates | null;
  radiusMeters: number;
  dwellSeconds?: number;
  previous: ArrivalWatchState;
}): ArrivalEvaluation {
  const { reading, target, previous } = input;
  const dwellSeconds = input.dwellSeconds ?? ARRIVAL_DWELL_SECONDS;

  if (!hasCoordinates(target) || !hasCoordinates(reading.coordinates)) {
    return { next: previous, arrived: false, phase: "unusable", distanceMeters: null, secondsRemaining: 0 };
  }

  const radius = arrivalRadiusMeters(input.radiusMeters);
  const distance = distanceMeters(reading.coordinates, target);
  const accuracy = Number.isFinite(reading.accuracyMeters) ? Math.max(0, reading.accuracyMeters) : radius;

  if (accuracy > radius) {
    return { next: previous, arrived: false, phase: "unusable", distanceMeters: distance, secondsRemaining: 0 };
  }

  if (distance + accuracy > radius) {
    return { next: IDLE_WATCH, arrived: false, phase: "outside", distanceMeters: distance, secondsRemaining: 0 };
  }

  const insideSinceMs = previous.insideSinceMs ?? reading.atMs;
  const heldSeconds = (reading.atMs - insideSinceMs) / 1000;

  if (heldSeconds >= dwellSeconds) {
    return {
      next: { insideSinceMs },
      arrived: true,
      phase: "arrived",
      distanceMeters: distance,
      secondsRemaining: 0,
    };
  }

  return {
    next: { insideSinceMs },
    arrived: false,
    phase: "settling",
    distanceMeters: distance,
    secondsRemaining: Math.max(0, Math.ceil(dwellSeconds - heldSeconds)),
  };
}

/** Metres as somebody standing in the United States would say them. */
export function formatDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 1000) return `${Math.round(feet / 10) * 10} ft`;
  return `${(feet / 5280).toFixed(1)} mi`;
}

/**
 * Why the phone could not say where it is, in words that suggest what to do.
 *
 * Every one of these ends at the same place — tap Mark arrived — because none
 * of them is a reason to stop working. Losing GPS must never be able to hold up
 * a job.
 */
export function describeArrivalError(code: number | undefined): string {
  if (code === 1) {
    return "Location is off for this site, so arrival will not be picked up automatically. Mark arrived when you get there.";
  }
  if (code === 2) {
    return "Your phone could not get a fix. Mark arrived when you get there.";
  }
  if (code === 3) {
    return "Locating is taking too long. Mark arrived when you get there.";
  }
  return "Could not confirm your location. Mark arrived when you get there.";
}
