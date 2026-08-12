import test from "node:test";
import assert from "node:assert/strict";

import { swipeIntent, SWIPE_THRESHOLD } from "./swipe.ts";

test("a firm pull to the left reveals the button", () => {
  assert.equal(swipeIntent({ x: 300, y: 100 }, { x: 200, y: 100 }), "open");
});

test("pulling back to the right puts it away again", () => {
  assert.equal(swipeIntent({ x: 200, y: 100 }, { x: 300, y: 100 }), "close");
});

test("a scroll down the list does not open anything", () => {
  // The case this exists for. A thumb travelling 300px down a list of invoices
  // drifts sideways as it goes, and every one of those rows would otherwise
  // offer to delete itself on the way past.
  assert.equal(swipeIntent({ x: 300, y: 100 }, { x: 220, y: 400 }), "none");
});

test("a diagonal that is mostly sideways still counts", () => {
  // Somebody swiping deliberately while the phone moves in their hand.
  assert.equal(swipeIntent({ x: 300, y: 100 }, { x: 180, y: 130 }), "open");
});

test("a tap that wobbles is not a swipe", () => {
  assert.equal(swipeIntent({ x: 300, y: 100 }, { x: 288, y: 103 }), "none");
});

test("exactly the threshold is enough", () => {
  assert.equal(swipeIntent({ x: 300, y: 100 }, { x: 300 - SWIPE_THRESHOLD, y: 100 }), "open");
  assert.equal(swipeIntent({ x: 300, y: 100 }, { x: 300 - SWIPE_THRESHOLD + 1, y: 100 }), "none");
});

test("a missing touch decides nothing", () => {
  // Touch handlers fire with an empty list often enough that guessing here
  // would open rows on a gesture that had already ended.
  assert.equal(swipeIntent(null, { x: 200, y: 100 }), "none");
  assert.equal(swipeIntent({ x: 300, y: 100 }, null), "none");
});
