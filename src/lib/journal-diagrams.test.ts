import test from "node:test";
import assert from "node:assert/strict";

import {
  describeDiagrams,
  diagramLabels,
  diagramSpec,
  DIAGRAMS,
  isDiagramKey,
} from "./journal-diagrams.ts";

test("every diagram is fully described to the model", () => {
  // The model picks by what a diagram shows, not by its key. A spec missing its
  // slot names is one it will label in the wrong order.
  for (const spec of DIAGRAMS) {
    assert.ok(spec.shows.length > 40, `${spec.key} is barely described`);
    assert.equal(spec.slotNames.length, spec.slots, `${spec.key} slot names`);
    assert.equal(spec.defaults.length, spec.slots, `${spec.key} defaults`);
    for (const fallback of spec.defaults) assert.ok(fallback.length > 0, spec.key);
  }
});

test("keys are unique, because the renderer maps on them", () => {
  const keys = DIAGRAMS.map((spec) => spec.key);
  assert.equal(new Set(keys).size, keys.length);
});

test("a diagram is never drawn half-labelled", () => {
  // A model that returns two labels for a three-slot diagram would otherwise
  // publish a picture with a blank space where the third should be.
  const short = diagramLabels("panel-trip", ["The dryer circuit"]);
  assert.equal(short.length, 3);
  assert.equal(short[0], "The dryer circuit");
  assert.ok(short[1]!.length > 0);
  assert.ok(short[2]!.length > 0);
});

test("extra labels are dropped rather than overflowing the drawing", () => {
  const many = diagramLabels("series-parallel", ["one", "two", "three", "four"]);
  assert.deepEqual(many, ["one", "two"]);
});

test("a long label is cut before it overlaps the next one", () => {
  // There is a fixed amount of room in the SVG. A sentence in a label lands on
  // top of the thing beside it.
  const [label] = diagramLabels("panel-trip", ["x".repeat(200)]);
  assert.ok(label!.length <= 42, `${label!.length} characters`);
});

test("labels are cleaned, not trusted", () => {
  assert.deepEqual(diagramLabels("series-parallel", ["  spaced   out  ", 42]), [
    "spaced out",
    DIAGRAMS.find((spec) => spec.key === "series-parallel")!.defaults[1],
  ]);
});

test("a key the model invented draws nothing at all", () => {
  // Fails closed. A post with no diagram is fine; a crash on a public page is
  // not, and neither is a blank box where a picture was promised.
  assert.equal(isDiagramKey("panel-trip"), true);
  assert.equal(isDiagramKey("exploded-view-of-a-transformer"), false);
  assert.equal(diagramSpec("nonsense"), null);
  assert.deepEqual(diagramLabels("nonsense", ["a", "b"]), []);
});

test("the catalogue given to the model names every key and its slots", () => {
  const described = describeDiagrams();
  for (const spec of DIAGRAMS) {
    assert.match(described, new RegExp(spec.key));
    assert.match(described, new RegExp(`${spec.slots} labels`));
  }
});
