import test from "node:test";
import assert from "node:assert/strict";

import { joinSpoken, spokenSince } from "./dictation.ts";

/** The shape a recogniser hands back: a list of results, each a list of guesses. */
const heard = (...sentences: string[]) => sentences.map((transcript) => [{ transcript }]);

test("only the results that have not been read yet", () => {
  // The bug this exists to prevent: a continuous recogniser resends the whole
  // session every time, so reading from 0 twice repeats the first sentence.
  const results = heard("check the panel", "the breaker is warm");

  assert.equal(spokenSince(results, 0), "check the panel the breaker is warm");
  assert.equal(spokenSince(results, 1), "the breaker is warm");
  assert.equal(spokenSince(results, 2), "");
});

test("a count past the end, or before the start, is not a crash", () => {
  const results = heard("one");

  assert.equal(spokenSince(results, 9), "");
  assert.equal(spokenSince(results, -3), "one");
  assert.equal(spokenSince([], 0), "");
});

test("second guesses are ignored", () => {
  // Every result carries alternatives. Stacking them says the same thing twice.
  const results = [[{ transcript: "the breaker" }, { transcript: "the bracket" }]];

  assert.equal(spokenSince(results, 0), "the breaker");
});

test("silence between sentences does not become blank words", () => {
  const results = heard("panel", "   ", "warm");

  assert.equal(spokenSince(results, 0), "panel warm");
});

test("a missing transcript is skipped rather than printed", () => {
  const results = [[], [{ transcript: "warm" }]] as { transcript: string }[][];

  assert.equal(spokenSince(results, 0), "warm");
});

test("dictation joins what is already typed with one space", () => {
  assert.equal(joinSpoken("Found the fault", "in the sub panel"), "Found the fault in the sub panel");
  assert.equal(joinSpoken("", "in the sub panel"), "in the sub panel");
  assert.equal(joinSpoken("Found the fault ", "in the sub panel"), "Found the fault in the sub panel");
});

test("a paragraph break somebody typed survives being dictated into", () => {
  // The old version trimmed the existing text first, which silently deleted
  // the blank line every time a sentence was added by voice.
  assert.equal(joinSpoken("First line.\n\n", "Second line."), "First line.\n\nSecond line.");
});

test("hearing nothing changes nothing", () => {
  assert.equal(joinSpoken("Found the fault", ""), "Found the fault");
  assert.equal(joinSpoken("Found the fault", "   "), "Found the fault");
  assert.equal(joinSpoken("", ""), "");
});
