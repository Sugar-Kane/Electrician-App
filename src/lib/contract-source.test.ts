import assert from "node:assert/strict";
import test from "node:test";

import { contractSourceMatches } from "./contract-source.ts";

const source = {
  body: "Install the new panel. Payment is due on completion.",
  scope: "Install the new panel.",
  unfilled: [] as string[],
};

test("the exact source snapshot is eligible to send", () => {
  assert.equal(contractSourceMatches({ ...source }, source), true);
});

test("a PDF rendered before a scope edit is not eligible to send", () => {
  assert.equal(
    contractSourceMatches(
      {
        body: "Inspect the old panel. Payment is due on completion.",
        scope: "Inspect the old panel.",
        unfilled: [],
      },
      source,
    ),
    false,
  );
});

test("a pre-snapshot PDF is rebuilt before it can be sent", () => {
  assert.equal(contractSourceMatches(null, source), false);
});

test("placeholder state is part of the frozen document", () => {
  assert.equal(contractSourceMatches({ ...source, unfilled: ["total"] }, source), false);
});

test("a malformed snapshot is never treated as current", () => {
  assert.equal(contractSourceMatches({ ...source, unfilled: "none" }, source), false);
});
