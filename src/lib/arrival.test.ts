import test from "node:test";
import assert from "node:assert/strict";

import {
  ARRIVAL_DWELL_SECONDS,
  DEFAULT_ARRIVAL_RADIUS_METERS,
  MAXIMUM_ARRIVAL_RADIUS_METERS,
  MINIMUM_ARRIVAL_RADIUS_METERS,
  arrivalRadiusMeters,
  distanceMeters,
  evaluateArrival,
  formatDistance,
  IDLE_WATCH,
} from "./arrival.ts";

/** 994 Red Gum Lane, Nipomo — the address on the job this was designed against. */
const PROPERTY = { lat: 35.0428, lng: -120.4766 };

/** A point `meters` due north of the property, for readable test distances. */
function north(meters: number) {
  return { lat: PROPERTY.lat + meters / 111_320, lng: PROPERTY.lng };
}

test("distance is measured in metres over the ground", () => {
  assert.equal(Math.round(distanceMeters(PROPERTY, PROPERTY)), 0);
  assert.ok(Math.abs(distanceMeters(PROPERTY, north(100)) - 100) < 1);
  assert.ok(Math.abs(distanceMeters(PROPERTY, north(1000)) - 1000) < 5);
});

test("distance does not care which way round the points are given", () => {
  const there = distanceMeters(PROPERTY, north(250));
  const back = distanceMeters(north(250), PROPERTY);
  assert.ok(Math.abs(there - back) < 0.001);
});

test("driving past does not count as arriving", () => {
  // The whole reason for the dwell timer. A bare geofence fires at the moment
  // of crossing — at the end of the street, at the neighbour's, and again on
  // the way to the next job.
  const first = evaluateArrival({
    reading: { coordinates: north(30), accuracyMeters: 10, atMs: 0 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: IDLE_WATCH,
  });

  assert.equal(first.arrived, false);
  assert.equal(first.phase, "settling");

  const gone = evaluateArrival({
    reading: { coordinates: north(600), accuracyMeters: 10, atMs: 20_000 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: first.next,
  });

  assert.equal(gone.phase, "outside");
  assert.equal(gone.next.insideSinceMs, null, "leaving has to reset the timer");
});

test("staying put for the dwell time is arriving", () => {
  const settling = evaluateArrival({
    reading: { coordinates: north(30), accuracyMeters: 10, atMs: 0 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: IDLE_WATCH,
  });

  assert.equal(settling.secondsRemaining, ARRIVAL_DWELL_SECONDS);

  const held = evaluateArrival({
    reading: { coordinates: north(25), accuracyMeters: 10, atMs: ARRIVAL_DWELL_SECONDS * 1000 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: settling.next,
  });

  assert.equal(held.arrived, true);
  assert.equal(held.phase, "arrived");
});

test("the timer counts from the first reading inside, not the latest one", () => {
  let state = IDLE_WATCH;
  let last = evaluateArrival({
    reading: { coordinates: north(40), accuracyMeters: 8, atMs: 0 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: state,
  });
  state = last.next;

  // A phone reports every few seconds while parked. Restarting the wait on each
  // one is how a technician stands at the door for ten minutes still "on the
  // way".
  for (const atMs of [5_000, 15_000, 30_000]) {
    last = evaluateArrival({
      reading: { coordinates: north(35), accuracyMeters: 8, atMs },
      target: PROPERTY,
      radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
      previous: state,
    });
    assert.equal(last.arrived, false);
    state = last.next;
  }

  const final = evaluateArrival({
    reading: { coordinates: north(35), accuracyMeters: 8, atMs: ARRIVAL_DWELL_SECONDS * 1000 + 1 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: state,
  });

  assert.equal(final.arrived, true);
});

test("a vague fix cannot confirm arrival on its own", () => {
  // Standing exactly on the property, but the phone will only admit to being
  // somewhere within 90m of there. Half of that circle is the neighbours.
  const vague = evaluateArrival({
    reading: { coordinates: PROPERTY, accuracyMeters: 90, atMs: 0 },
    target: PROPERTY,
    radiusMeters: 100,
    previous: IDLE_WATCH,
  });

  assert.equal(vague.arrived, false);
  assert.equal(vague.phase, "settling", "dead centre with room to spare still counts");

  const tooVague = evaluateArrival({
    reading: { coordinates: PROPERTY, accuracyMeters: 260, atMs: 0 },
    target: PROPERTY,
    radiusMeters: 100,
    previous: IDLE_WATCH,
  });

  assert.equal(tooVague.phase, "unusable");
});

test("a spell of bad signal does not throw away the wait", () => {
  // Parked outside the house, phone loses the sky for thirty seconds. Treating
  // that as leaving would restart the timer every time somebody walks into a
  // garage — which is where the panel is.
  const settling = evaluateArrival({
    reading: { coordinates: north(20), accuracyMeters: 10, atMs: 0 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: IDLE_WATCH,
  });

  const blind = evaluateArrival({
    reading: { coordinates: north(20), accuracyMeters: 400, atMs: 20_000 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: settling.next,
  });

  assert.equal(blind.phase, "unusable");
  assert.equal(blind.next.insideSinceMs, settling.next.insideSinceMs);

  const recovered = evaluateArrival({
    reading: { coordinates: north(20), accuracyMeters: 12, atMs: ARRIVAL_DWELL_SECONDS * 1000 },
    target: PROPERTY,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: blind.next,
  });

  assert.equal(recovered.arrived, true);
});

test("a job with no coordinates never arrives by itself", () => {
  // Phone-booked properties are not geocoded until something needs a map. The
  // technician taps Mark arrived; nothing here guesses.
  const nowhere = evaluateArrival({
    reading: { coordinates: PROPERTY, accuracyMeters: 5, atMs: 0 },
    target: null,
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: IDLE_WATCH,
  });

  assert.equal(nowhere.phase, "unusable");
  assert.equal(nowhere.arrived, false);
  assert.equal(nowhere.distanceMeters, null);
});

test("null island is not a destination", () => {
  const atlantic = evaluateArrival({
    reading: { coordinates: PROPERTY, accuracyMeters: 5, atMs: 0 },
    target: { lat: 0, lng: 0 },
    radiusMeters: DEFAULT_ARRIVAL_RADIUS_METERS,
    previous: IDLE_WATCH,
  });

  assert.equal(atlantic.phase, "unusable");
});

test("a business radius is kept inside what a geofence can honour", () => {
  assert.equal(arrivalRadiusMeters(null), DEFAULT_ARRIVAL_RADIUS_METERS);
  assert.equal(arrivalRadiusMeters("240"), 240, "numeric arrives as a string over PostgREST");
  // Smaller than a good fix means an arrival that can never happen.
  assert.equal(arrivalRadiusMeters(5), MINIMUM_ARRIVAL_RADIUS_METERS);
  assert.equal(arrivalRadiusMeters(99_999), MAXIMUM_ARRIVAL_RADIUS_METERS);
  assert.equal(arrivalRadiusMeters(Number.NaN), DEFAULT_ARRIVAL_RADIUS_METERS);
});

test("a big rural radius still works", () => {
  // A ranch where the gate and the panel are a quarter mile apart.
  const atGate = evaluateArrival({
    reading: { coordinates: north(300), accuracyMeters: 15, atMs: 0 },
    target: PROPERTY,
    radiusMeters: 800,
    previous: IDLE_WATCH,
  });

  assert.equal(atGate.phase, "settling");
});

test("distance is said in feet and miles", () => {
  assert.equal(formatDistance(30), "100 ft");
  assert.equal(formatDistance(8046), "5.0 mi");
});
