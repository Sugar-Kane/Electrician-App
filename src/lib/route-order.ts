/**
 * Putting the day's stops in the order they should be driven.
 *
 * The page has been called a route optimizer since it was built and has never
 * optimized anything: it took the first three jobs of the day in whatever order
 * the schedule listed them, capped at three by a `slice(0, 3)` nobody removed.
 * A four-job day silently lost a job from the route, and the "built" order was
 * the booking order, which is the order the phone rang in — not an order
 * anybody would drive.
 *
 * Nearest-neighbour from the origin. It is not the shortest possible route and
 * does not pretend to be; it is a large improvement on booking order, it is
 * explainable to the driver, and it is stable — the same stops always produce
 * the same order, which matters because the driver is going to compare it
 * against what they expected.
 *
 * Import-free, so the ordering can be tested without a map.
 */

import { hasCoordinates, type Coordinates } from "./coordinates.ts";

export type RouteStopInput = {
  id: string;
  label: string;
  address: string;
  detail: string;
  kind: "base" | "supply" | "job";
  point?: Coordinates | null;
  /** Taken off the route without being forgotten about. */
  skipped?: boolean;
};

/**
 * Distance between two points, good enough to sort by.
 *
 * Equirectangular rather than haversine: over a service area of a few dozen
 * miles the difference does not change any ordering decision, and this is
 * comparing distances rather than reporting them.
 */
export function roughDistance(a: Coordinates, b: Coordinates): number {
  const latitudeSpan = b.lat - a.lat;
  // Longitude degrees narrow toward the poles, so they have to be scaled or a
  // north–south route looks shorter than it is.
  const longitudeSpan = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.sqrt(latitudeSpan * latitudeSpan + longitudeSpan * longitudeSpan);
}

/**
 * The stops, ordered from the origin.
 *
 * Stops with no coordinates keep their original order and go last. They cannot
 * be placed, so any claim about where they fall in a driving order would be
 * invented — and they are the ones most likely to be a bad address that needs
 * looking at rather than driving to.
 */
export function orderStops<T extends RouteStopInput>(input: {
  origin?: Coordinates | null;
  stops: T[];
}): T[] {
  const live = input.stops.filter((stop) => !stop.skipped);
  const placed = live.filter((stop) => hasCoordinates(stop.point));
  const unplaced = live.filter((stop) => !hasCoordinates(stop.point));

  if (!hasCoordinates(input.origin) || placed.length === 0) {
    return [...placed, ...unplaced];
  }

  const remaining = [...placed];
  const ordered: T[] = [];
  let cursor: Coordinates = input.origin;

  while (remaining.length > 0) {
    let bestIndex = 0;
    let bestDistance = Number.POSITIVE_INFINITY;

    remaining.forEach((stop, index) => {
      const distance = roughDistance(cursor, stop.point as Coordinates);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = index;
      }
    });

    const [next] = remaining.splice(bestIndex, 1);
    if (!next) break;
    ordered.push(next);
    cursor = next.point as Coordinates;
  }

  return [...ordered, ...unplaced];
}

/**
 * Move one stop up or down by hand.
 *
 * The computed order is a suggestion. The driver knows that the Nipomo job
 * cannot be done before ten because nobody is home, and no distance function
 * is ever going to know that.
 */
export function moveStop<T extends { id: string }>(stops: T[], id: string, delta: number): T[] {
  const index = stops.findIndex((stop) => stop.id === id);
  if (index < 0) return stops;

  const target = index + delta;
  if (target < 0 || target >= stops.length) return stops;

  const next = [...stops];
  const [moved] = next.splice(index, 1);
  if (!moved) return stops;
  next.splice(target, 0, moved);
  return next;
}

/** The total straight-line distance of a route, for a rough "is this sane" figure. */
export function routeSpan(origin: Coordinates | null | undefined, stops: RouteStopInput[]): number {
  let total = 0;
  let cursor = hasCoordinates(origin) ? origin : null;

  for (const stop of stops) {
    if (!hasCoordinates(stop.point)) continue;
    if (cursor) total += roughDistance(cursor, stop.point);
    cursor = stop.point;
  }

  return total;
}

/** Rough miles, for a figure a driver can sanity-check against the day. */
export function spanInMiles(span: number): number {
  // One degree of latitude is about 69 miles. This is a straight-line estimate
  // and is labelled as one wherever it is shown — roads are longer.
  return Math.round(span * 69 * 10) / 10;
}
