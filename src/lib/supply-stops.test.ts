import test from "node:test";
import assert from "node:assert/strict";

import { SUPPLY_STOP_KINDS, isSupplyStopKind, supplyStopLabel } from "./supply-stops.ts";

test("the kinds the database accepts are the kinds the form offers", () => {
  // The check constraint on `supply_stops.kind` holds exactly these four. A
  // fifth here would be a choice that saves as a constraint violation.
  assert.deepEqual(
    SUPPLY_STOP_KINDS.map((kind) => kind.value).sort(),
    ["other", "storage", "store", "supplier"],
  );

  for (const kind of SUPPLY_STOP_KINDS) {
    assert.ok(isSupplyStopKind(kind.value), kind.value);
    assert.ok(kind.label.trim().length > 0, kind.value);
  }
});

test("somewhere an electrician actually keeps stock is one of them", () => {
  // The two hardcoded stores were both shops. Most of an electrician's stock
  // lives in a unit somewhere, and that was not expressible at all.
  assert.ok(isSupplyStopKind("storage"));
  assert.equal(supplyStopLabel("storage"), "My storage");
});

test("a kind nobody planned for still reads as words", () => {
  assert.equal(isSupplyStopKind("warehouse"), false);
  assert.equal(supplyStopLabel("warehouse"), "Somewhere else");
  assert.equal(supplyStopLabel(""), "Somewhere else");
});
