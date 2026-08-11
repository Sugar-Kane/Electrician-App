import test from "node:test";
import assert from "node:assert/strict";

import { keyTail } from "./map-key.ts";

test("an unset key says so rather than showing an empty hint", () => {
  // The empty case is a different fault from a wrong key, and the map already
  // renders separate copy for it. A blank tail would blur the two.
  assert.equal(keyTail(""), "(nothing)");
  assert.equal(keyTail("   "), "(nothing)");
  assert.equal(keyTail(undefined), "(nothing)");
  assert.equal(keyTail(null), "(nothing)");
});

test("only the tail is shown, never the key", () => {
  const key = "AIzaSyD-ExampleBrowserKeyValue123456";
  const shown = keyTail(key);

  assert.equal(shown, "…123456");
  assert.ok(!shown.includes("AIza"), "the identifying prefix must not appear");
  assert.ok(key.includes(shown.slice(1)), "the tail must actually come from the key");
});

test("two keys that differ only at the end are still told apart", () => {
  // This is the whole point: the browser and geocoding keys got swapped, and
  // the question on screen is which one is in the browser variable.
  assert.notEqual(keyTail("AIzaSyBrowserKeyAAAAAA"), keyTail("AIzaSyServerKeyBBBBBB"));
});

test("a key too short to mask still is not printed whole", () => {
  // No input should make this function echo its argument back.
  const shown = keyTail("abcd");
  assert.equal(shown, "…cd");
  assert.ok(!shown.includes("abcd"));
});
