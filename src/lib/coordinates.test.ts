import test from "node:test";
import assert from "node:assert/strict";

import { hasCoordinates } from "./coordinates.ts";

test("null island is treated as no location at all", () => {
  // Properties created from a phone call carry null coordinates, which the job
  // mapper read as 0,0 — a real point in the Atlantic off West Africa. Nothing
  // plotted it, so nobody noticed until there was a map.
  assert.equal(hasCoordinates({ lat: 0, lng: 0 }), false);
});

test("missing and unusable values are not locations", () => {
  assert.equal(hasCoordinates(null), false);
  assert.equal(hasCoordinates(undefined), false);
  assert.equal(hasCoordinates({ lat: null, lng: null }), false);
  assert.equal(hasCoordinates({ lat: 35.03, lng: null }), false);
  assert.equal(hasCoordinates({ lat: Number.NaN, lng: 12 }), false);
});

test("a point outside the world is refused rather than drawn", () => {
  assert.equal(hasCoordinates({ lat: 91, lng: 0 }), false);
  assert.equal(hasCoordinates({ lat: -91, lng: 0 }), false);
  assert.equal(hasCoordinates({ lat: 0, lng: 181 }), false);
  assert.equal(hasCoordinates({ lat: 0, lng: -181 }), false);
});

test("a real address in the service area is a location", () => {
  // Nipomo, California.
  assert.equal(hasCoordinates({ lat: 35.0428, lng: -120.4766 }), true);
});

test("a genuine zero on one axis is still a location", () => {
  // Only both-zero is the sentinel. Greenwich and the equator are real places.
  assert.equal(hasCoordinates({ lat: 51.4779, lng: 0 }), true);
  assert.equal(hasCoordinates({ lat: 0, lng: -78.4678 }), true);
});
