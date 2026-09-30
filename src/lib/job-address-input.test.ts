import test from "node:test";
import assert from "node:assert/strict";

import { keepPhoneDigits, keepZipDigits } from "./digits-input.ts";
import {
  MAX_ACCESS_NOTES_LENGTH,
  MAX_UNIT_LENGTH,
  readAccessNotes,
  readUnit,
  streetWithUnit,
} from "./property-details.ts";
import { isUsStateCode, US_STATES } from "./us-states.ts";

test("a phone box keeps digits and nothing else", () => {
  assert.equal(keepPhoneDigits("8055550142"), "8055550142");
  assert.equal(keepPhoneDigits("805-555-0142"), "8055550142");
  assert.equal(keepPhoneDigits("805abc555"), "805555");
  assert.equal(keepPhoneDigits(""), "");
});

test("a pasted number with its country code keeps the ten digits that are the number", () => {
  assert.equal(keepPhoneDigits("+1 (805) 555-0142"), "8055550142");
  assert.equal(keepPhoneDigits("18055550142"), "8055550142");
});

test("a phone box stops at ten digits", () => {
  // Not a leading 1, so nothing to drop: the extra digits are cut off.
  assert.equal(keepPhoneDigits("80555501429999"), "8055550142");
});

test("a ZIP box keeps five digits", () => {
  assert.equal(keepZipDigits("93444"), "93444");
  assert.equal(keepZipDigits("9x3-4a44"), "93444");
  // A pasted ZIP+4 keeps the ZIP.
  assert.equal(keepZipDigits("93444-1234"), "93444");
  assert.equal(keepZipDigits("934"), "934");
});

test("the state list is the fifty states and D.C., each once", () => {
  assert.equal(US_STATES.length, 51);
  assert.equal(new Set(US_STATES.map((state) => state.code)).size, 51);
  assert.ok(US_STATES.every((state) => /^[A-Z]{2}$/.test(state.code)));
  // Sorted by name, which is what the list is read in and typed to.
  const names = US_STATES.map((state) => state.name);
  assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
});

test("a state is one of the codes, exactly", () => {
  assert.equal(isUsStateCode("CA"), true);
  assert.equal(isUsStateCode("DC"), true);
  assert.equal(isUsStateCode("ca"), false);
  assert.equal(isUsStateCode("Cali"), false);
  // A territory could only arrive typed, and the list does not have them.
  assert.equal(isUsStateCode("PR"), false);
  assert.equal(isUsStateCode(""), false);
});

test("a unit is one tidy line", () => {
  assert.equal(readUnit("  Apt   4B "), "Apt 4B");
  assert.equal(readUnit("Floor 2\nBuilding C"), "Floor 2 Building C");
  assert.equal(readUnit(undefined), "");
  assert.equal(readUnit("x".repeat(MAX_UNIT_LENGTH + 20)).length, MAX_UNIT_LENGTH);
});

test("access notes keep their line breaks", () => {
  assert.equal(
    readAccessNotes("  Gate code 4521\r\nDog in the yard\n\n"),
    "Gate code 4521\nDog in the yard",
  );
  assert.equal(readAccessNotes(42), "");
  assert.equal(
    readAccessNotes("n".repeat(MAX_ACCESS_NOTES_LENGTH + 5)).length,
    MAX_ACCESS_NOTES_LENGTH,
  );
});

test("the street is shown with its unit when there is one", () => {
  assert.equal(streetWithUnit("12 Oak Ave", "Apt 4B"), "12 Oak Ave, Apt 4B");
  assert.equal(streetWithUnit("12 Oak Ave", ""), "12 Oak Ave");
  assert.equal(streetWithUnit(" 12 Oak Ave ", "  "), "12 Oak Ave");
  assert.equal(streetWithUnit("", "Apt 4B"), "Apt 4B");
});
