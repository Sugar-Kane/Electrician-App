import assert from "node:assert/strict";
import { test } from "node:test";

import { chooseMembership } from "./active-business.ts";

/*
 * Which business a request acts for. Only ever one the caller belongs to.
 */

const A = "a1000000-0000-4000-8000-00000000000a";
const B = "b1000000-0000-4000-8000-00000000000b";
const C = "c1000000-0000-4000-8000-00000000000c";
const both = [{ organization_id: A, role: "owner" }, { organization_id: B, role: "technician" }];

test("someone in one business acts for it", () => {
  assert.equal(chooseMembership([both[0]!], {})?.organization_id, A);
});

test("someone in two acts for the one they chose", () => {
  assert.equal(chooseMembership(both, { chosenOrganizationId: B })?.organization_id, B);
  assert.equal(chooseMembership(both, { chosenOrganizationId: B.toUpperCase() })?.organization_id, B);
  // With their role in that business, not the other.
  assert.equal(chooseMembership(both, { chosenOrganizationId: B })?.role, "technician");
});

test("a choice naming a business they are not in is ignored, never honoured", () => {
  assert.equal(chooseMembership(both, { chosenOrganizationId: C })?.organization_id, A);
  assert.equal(chooseMembership([], { chosenOrganizationId: C }), null);
});

test("without a choice, the first membership", () => {
  assert.equal(chooseMembership(both, { chosenOrganizationId: "" })?.organization_id, A);
});

test("impersonating, only the opened business, and nothing if there is no membership for it", () => {
  assert.equal(chooseMembership(both, { impersonatingOrganizationId: B, chosenOrganizationId: A })?.organization_id, B);
  assert.equal(chooseMembership(both, { impersonatingOrganizationId: C }), null);
});
