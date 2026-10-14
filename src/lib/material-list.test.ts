import test from "node:test";
import assert from "node:assert/strict";

import { estimateItems, estimateLineFor, parseMaterialList } from "./material-list.ts";

test("a listed count goes onto the estimate as exactly that many, fractions included", () => {
  const cases: [string, string, string, string][] = [
    ["1/2", "box wire nuts", "0.5", "each"],
    ["1 1/2", "ft liquidtight", "1.5", "each"],
    ["1 1/2 ft", "liquidtight", "1.5", "ft"],
    ["1½", "box staples", "1.5", "each"],
    ["½", "box staples", "0.5", "each"],
    ["40 ft", "#10 THHN", "40", "ft"],
    ["2.5", "rolls tape", "2.5", "each"],
    ["4", "10-ft sticks ¾\" EMT", "4", "stick"],
  ];
  for (const [qty, name, quantity, unit] of cases) {
    const line = estimateLineFor({ qty, name });
    assert.equal(line.quantity, quantity, `${qty} × ${name}`);
    assert.equal(line.unit, unit, `${qty} × ${name}`);
  }
});

test("a count that cannot be read is never guessed above one", () => {
  for (const qty of ["", "a few", "0", "1/0", "0/4"]) {
    assert.equal(estimateLineFor({ qty, name: "duct seal" }).quantity, "1", JSON.stringify(qty));
  }
});

test("only things to buy can be priced: the checklist of what to verify is left off the estimate", () => {
  const list = parseMaterialList(
    [
      "# Test — Mini-Split Material List",
      "## Breaker & Disconnect",
      "- 1 × Eaton BR220 breaker",
      "## I'd Buy Before the Job",
      "- 4 × 10-ft sticks ¾\" EMT",
      "## Before Installation Day",
      "- Verify the nameplate MCA and MOCP",
      "- Verify permits",
    ].join("\n"),
    "t",
  );
  const names = estimateItems(list).map((item) => item.name);
  assert.deepEqual(names, ["Eaton BR220 breaker", "10-ft sticks ¾\" EMT"]);
});
