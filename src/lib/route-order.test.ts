import test from "node:test";
import assert from "node:assert/strict";

import {
  moveStop,
  orderStops,
  roughDistance,
  routeSpan,
  spanInMiles,
  type RouteStopInput,
} from "./route-order.ts";

const stop = (
  id: string,
  point: { lat: number; lng: number } | null,
  over: Partial<RouteStopInput> = {},
): RouteStopInput => ({
  id,
  label: id,
  address: `${id} Street`,
  detail: "",
  kind: "job",
  point,
  ...over,
});

// Roughly the real service area: the shop in Santa Maria, jobs spread south
// and east toward Nipomo.
const SHOP = { lat: 34.953, lng: -120.436 };
const NEAR = stop("near", { lat: 34.96, lng: -120.44 });
const MIDDLE = stop("middle", { lat: 35.0, lng: -120.47 });
const FAR = stop("far", { lat: 35.14, lng: -120.63 });

test("stops come back nearest-first from the origin", () => {
  // Booking order is the order the phone rang in, which is not an order
  // anybody would drive.
  const ordered = orderStops({ origin: SHOP, stops: [FAR, NEAR, MIDDLE] });

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["near", "middle", "far"],
  );
});

test("ordering chains from each stop, not from the origin every time", () => {
  // Nearest-neighbour, not "sort by distance from the shop". Two stops close to
  // each other and far from the origin should be visited together.
  const a = stop("a", { lat: 35.5, lng: -120.5 });
  const b = stop("b", { lat: 35.51, lng: -120.5 });
  const c = stop("c", { lat: 35.0, lng: -120.5 });

  const ordered = orderStops({ origin: SHOP, stops: [a, c, b] });

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["c", "a", "b"],
  );
});

test("the same stops always order the same way", () => {
  // The driver compares this against what they expected. An order that moved
  // between renders would be worse than no order at all.
  const first = orderStops({ origin: SHOP, stops: [FAR, NEAR, MIDDLE] });
  const second = orderStops({ origin: SHOP, stops: [MIDDLE, FAR, NEAR] });

  assert.deepEqual(
    first.map((entry) => entry.id),
    second.map((entry) => entry.id),
  );
});

test("an unplaceable stop goes last rather than being guessed at", () => {
  // A stop with no coordinates cannot be given a position in a driving order
  // without inventing one, and it is the one most likely to be a bad address
  // that wants looking at rather than driving to.
  const nowhere = stop("nowhere", null);
  const ordered = orderStops({ origin: SHOP, stops: [nowhere, FAR, NEAR] });

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["near", "far", "nowhere"],
  );
});

test("null island is not treated as a location", () => {
  // 0,0 is a real point in the Atlantic. A stop carrying it would otherwise be
  // ordered as the furthest thing on the route.
  const atlantic = stop("atlantic", { lat: 0, lng: 0 });
  const ordered = orderStops({ origin: SHOP, stops: [atlantic, NEAR] });

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["near", "atlantic"],
  );
});

test("with no origin the stops keep the order they came in", () => {
  // Nothing to measure from, so inventing an order would be a claim the data
  // does not support.
  const ordered = orderStops({ origin: null, stops: [FAR, NEAR, MIDDLE] });

  assert.deepEqual(
    ordered.map((entry) => entry.id),
    ["far", "near", "middle"],
  );
});

test("skipped stops are left out of the route entirely", () => {
  const skipped = stop("skipped", { lat: 34.955, lng: -120.437 }, { skipped: true });
  const ordered = orderStops({ origin: SHOP, stops: [skipped, FAR, NEAR] });

  assert.equal(
    ordered.some((entry) => entry.id === "skipped"),
    false,
  );
  assert.equal(ordered.length, 2);
});

test("every stop survives the ordering", () => {
  // The bug this replaces: a slice(0, 3) that silently dropped the fourth job
  // of the day off the route.
  const many = Array.from({ length: 9 }, (_unused, index) =>
    stop(`job-${index}`, { lat: 34.9 + index * 0.03, lng: -120.4 - index * 0.02 }),
  );

  const ordered = orderStops({ origin: SHOP, stops: many });

  assert.equal(ordered.length, 9);
  assert.equal(new Set(ordered.map((entry) => entry.id)).size, 9);
});

test("an empty day orders to nothing rather than failing", () => {
  assert.deepEqual(orderStops({ origin: SHOP, stops: [] }), []);
  assert.deepEqual(orderStops({ origin: null, stops: [] }), []);
});

test("longitude is scaled by latitude", () => {
  // Unscaled, a degree of longitude counts the same as a degree of latitude,
  // and at 35°N that overstates east–west distance by about a fifth — enough
  // to reorder two stops.
  const northSouth = roughDistance({ lat: 35, lng: -120 }, { lat: 36, lng: -120 });
  const eastWest = roughDistance({ lat: 35, lng: -120 }, { lat: 35, lng: -119 });

  assert.ok(eastWest < northSouth, `${eastWest} should be less than ${northSouth}`);
  assert.ok(eastWest > northSouth * 0.7);
});

test("a stop can be moved by hand", () => {
  // The computed order is a suggestion. Nobody is home at the Nipomo job until
  // ten, and no distance function will ever know that.
  const stops = [stop("a", null), stop("b", null), stop("c", null)];

  assert.deepEqual(
    moveStop(stops, "c", -1).map((entry) => entry.id),
    ["a", "c", "b"],
  );
  assert.deepEqual(
    moveStop(stops, "a", 1).map((entry) => entry.id),
    ["b", "a", "c"],
  );
});

test("moving off either end changes nothing", () => {
  const stops = [stop("a", null), stop("b", null)];

  assert.deepEqual(moveStop(stops, "a", -1), stops);
  assert.deepEqual(moveStop(stops, "b", 1), stops);
  assert.deepEqual(moveStop(stops, "missing", 1), stops);
});

test("the route length adds up the legs, origin included", () => {
  const span = routeSpan(SHOP, [NEAR, MIDDLE]);
  const legs =
    roughDistance(SHOP, NEAR.point!) + roughDistance(NEAR.point!, MIDDLE.point!);

  assert.ok(Math.abs(span - legs) < 1e-9);
});

test("unplaceable stops do not break the length or count toward it", () => {
  const withGap = routeSpan(SHOP, [NEAR, stop("nowhere", null), MIDDLE]);
  const without = routeSpan(SHOP, [NEAR, MIDDLE]);

  assert.ok(Math.abs(withGap - without) < 1e-9);
});

test("miles come out as a figure a driver can sanity-check", () => {
  // Santa Maria to Nipomo is about 13 miles by road, so a straight-line
  // estimate in the low teens is the right order of magnitude.
  const miles = spanInMiles(routeSpan(SHOP, [FAR]));

  assert.ok(miles > 5 && miles < 20, `got ${miles}`);
});
