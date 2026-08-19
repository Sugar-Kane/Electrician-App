import test from "node:test";
import assert from "node:assert/strict";

import { swipeIntent, swipeSide, SWIPE_THRESHOLD } from "./swipe.ts";

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

test("a row with two actions can tell the two directions apart", () => {
  // Delete on the left, archive on the right — the arrangement every mail app
  // uses, and the reason the gesture needed a direction rather than an opinion.
  assert.equal(swipeSide({ x: 200, y: 100 }, { x: 100, y: 104 }), "left");
  assert.equal(swipeSide({ x: 100, y: 100 }, { x: 200, y: 104 }), "right");
  assert.equal(swipeSide({ x: 200, y: 100 }, { x: 180, y: 104 }), "none");
});

test("scrolling past a row is not a swipe, in either direction", () => {
  // A thumb travelling down a list drifts sideways. Both directions have to
  // survive that or the list peels itself open as you scroll.
  assert.equal(swipeSide({ x: 200, y: 100 }, { x: 120, y: 260 }), "none");
  assert.equal(swipeSide({ x: 120, y: 100 }, { x: 200, y: 260 }), "none");
});

test("the one-action reading is the same gesture, named differently", () => {
  for (const [from, to] of [
    [{ x: 200, y: 100 }, { x: 100, y: 102 }],
    [{ x: 100, y: 100 }, { x: 200, y: 102 }],
    [{ x: 200, y: 100 }, { x: 190, y: 102 }],
    [{ x: 200, y: 100 }, { x: 100, y: 300 }],
  ] as const) {
    const side = swipeSide(from, to);
    const expected = side === "left" ? "open" : side === "right" ? "close" : "none";
    assert.equal(swipeIntent(from, to), expected, JSON.stringify([from, to]));
  }
});
