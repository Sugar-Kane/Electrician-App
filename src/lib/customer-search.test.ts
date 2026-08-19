import test from "node:test";
import assert from "node:assert/strict";

import {
  digitsOf,
  looksLikeAQuestion,
  matchScore,
  rankCustomers,
  type Searchable,
} from "./customer-search.ts";

const john: Searchable = {
  id: "1",
  name: "John Smith",
  phone: "(432) 555-1234",
  email: "john@example.com",
  address: "123 Main Street, Midland",
};

const johnny: Searchable = {
  id: "2",
  name: "John Rodriguez",
  phone: "432-555-9876",
  email: "jr@example.com",
  address: "817 Oak Avenue, Midland",
};

const smithers: Searchable = {
  id: "3",
  name: "Ana Smithers",
  phone: "",
  email: "ana@example.com",
  address: "9 Elm Court, Odessa",
};

const everyone = [john, johnny, smithers];

test("a first name finds every customer who has it", () => {
  // The example from the specification: type "John", see both Johns, with
  // enough beside each to tell them apart.
  const found = rankCustomers(everyone, "John");
  assert.deepEqual(
    found.map((customer) => customer.name),
    ["John Rodriguez", "John Smith"],
  );
});

test("a surname finds them too", () => {
  // A name is words, and somebody typing "smith" is not typing the start of
  // "John Smith". Matching only the start of the whole name loses them.
  assert.deepEqual(
    rankCustomers(everyone, "smith").map((customer) => customer.name),
    ["John Smith", "Ana Smithers"],
  );
});

test("half a phone number finds the number however it was written", () => {
  // Typed with dashes, stored with brackets and spaces. Comparing the strings
  // finds nothing; comparing the digits finds the customer.
  assert.deepEqual(
    rankCustomers(everyone, "432-555-12").map((customer) => customer.name),
    ["John Smith"],
  );
  assert.deepEqual(
    rankCustomers(everyone, "5559876").map((customer) => customer.name),
    ["John Rodriguez"],
  );
});

test("a phone number beats a name", () => {
  // Digits are the most certain thing anybody types — they are being read off
  // a screen — so they answer first.
  assert.ok(matchScore(john, "4325551234") > matchScore(john, "John"));
});

test("two digits are not yet a phone number", () => {
  // "12" appears in half the phone numbers ever issued. Below three digits it
  // is a street number, an apartment, or somebody still typing — and matching
  // it would fill the list before there was anything to go on.
  const noAddress = { ...john, address: "" };
  assert.equal(matchScore(noAddress, "12"), 0);
  assert.ok(matchScore(noAddress, "432") > 0);
});

test("the service address is searchable", () => {
  assert.deepEqual(
    rankCustomers(everyone, "Main Street").map((customer) => customer.name),
    ["John Smith"],
  );
  assert.deepEqual(
    rankCustomers(everyone, "odessa").map((customer) => customer.name),
    ["Ana Smithers"],
  );
});

test("email finds them, and ranks below the name", () => {
  assert.deepEqual(
    rankCustomers(everyone, "jr@").map((customer) => customer.name),
    ["John Rodriguez"],
  );
  assert.ok(matchScore(john, "John") > matchScore(john, "john@example.com"));
});

test("nothing typed matches nobody, and nonsense matches nobody", () => {
  assert.deepEqual(rankCustomers(everyone, ""), []);
  assert.deepEqual(rankCustomers(everyone, "   "), []);
  assert.deepEqual(rankCustomers(everyone, "zzzz"), []);
});

test("the order does not reshuffle between keystrokes", () => {
  // Two customers scoring the same must come back in the same order every
  // time, or the row under somebody's thumb changes as they reach for it.
  const twins: Searchable[] = [
    { ...john, id: "b", name: "Sam Brown" },
    { ...john, id: "a", name: "Sam Archer" },
  ];
  assert.deepEqual(
    rankCustomers(twins, "sam").map((customer) => customer.name),
    ["Sam Archer", "Sam Brown"],
  );
});

test("the list is capped", () => {
  const many: Searchable[] = Array.from({ length: 30 }, (_, index) => ({
    ...john,
    id: String(index),
    name: `John ${String(index).padStart(2, "0")}`,
  }));
  assert.equal(rankCustomers(many, "john").length, 8);
  assert.equal(rankCustomers(many, "john", 3).length, 3);
});

test("digits come out of anything", () => {
  assert.equal(digitsOf("+1 (432) 555-1234"), "14325551234");
  assert.equal(digitsOf("no digits here"), "");
});

test("a question is told apart from a name", () => {
  // The same box does both. Guessing "search" for something that was a
  // question costs a glance; guessing "assistant" for a name costs a model
  // call and a wait, so the line is drawn conservatively.
  assert.equal(looksLikeAQuestion("Who still needs an estimate?"), true);
  assert.equal(looksLikeAQuestion("show me John's most recent job"), true);
  assert.equal(looksLikeAQuestion("which appointments do I have tomorrow"), true);
  assert.equal(looksLikeAQuestion("123 Main Street"), false);
  assert.equal(looksLikeAQuestion("John"), false);
  assert.equal(looksLikeAQuestion("John Smith"), false);
  assert.equal(looksLikeAQuestion("432-555-1234"), false);
  assert.equal(looksLikeAQuestion(""), false);
});
