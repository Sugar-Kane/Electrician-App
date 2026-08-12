import test from "node:test";
import assert from "node:assert/strict";

import {
  buildReferenceBrief,
  findReferences,
  looksLikeCodeQuestion,
  referenceSystemPrompt,
  REFERENCE_CAVEAT,
  scoreEntry,
  terms,
} from "./code-reference.ts";
import { REFERENCE_ENTRIES } from "./code-reference-data.ts";

const ids = (question: string, limit = 6) =>
  findReferences(question, limit).map((entry) => entry.id);

test("a licence question finds the licence entries", () => {
  const found = ids("do I need a licence for a $600 job");

  assert.ok(found.includes("LIC-THRESHOLD"), found.join(", "));
});

test("plain-language questions find the right entry", () => {
  assert.ok(ids("what deposit can I take").includes("CONTRACT-DOWN"));
  assert.ok(ids("do I need a permit to add an EV charger").includes("PERMIT-R07"));
  assert.ok(ids("pool bonding requirements").includes("PERMIT-R11"));
  assert.ok(ids("old paint pre 1978 renovation").includes("EPA-RRP"));
  assert.ok(ids("what do I do with old fluorescent ballasts").includes("FED-PCB"));
});

test("an entry id typed verbatim returns that entry first", () => {
  assert.equal(ids("LIC-C10")[0], "LIC-C10");
  assert.equal(ids("what does INSP-KEY say")[0], "INSP-KEY");
});

test("a question about the business is not a code question", () => {
  // "What is booked tomorrow" should not drag in the asbestos standard.
  assert.equal(looksLikeCodeQuestion("what is booked tomorrow"), false);
  assert.equal(looksLikeCodeQuestion("who has not paid me"), false);
  assert.equal(looksLikeCodeQuestion(""), false);
});

test("a code question is recognised as one", () => {
  assert.equal(looksLikeCodeQuestion("what permit do I need for a service upgrade"), true);
  assert.equal(looksLikeCodeQuestion("can my trainee work unsupervised"), true);
});

test("stop words and plurals do not change the answer", () => {
  assert.deepEqual(terms("Do I need the permits?"), ["permit"]);
  assert.deepEqual(ids("permit"), ids("the permits"));
});

test("keywords outrank an incidental mention in the body", () => {
  const threshold = REFERENCE_ENTRIES.find((entry) => entry.id === "LIC-THRESHOLD")!;
  const records = REFERENCE_ENTRIES.find((entry) => entry.id === "RECORDS")!;

  // "licence" appears in both, but only one is about the licence threshold.
  assert.ok(scoreEntry("licence threshold", threshold) > scoreEntry("licence threshold", records));
});

test("nothing relevant returns nothing rather than the closest thing", () => {
  // Returning a loosely-related entry would let the model answer a question the
  // index does not cover, which is exactly the invented-citation failure.
  assert.deepEqual(ids("what is the weather in Lisbon"), []);
});

test("the brief says plainly when the index does not cover it", () => {
  assert.match(buildReferenceBrief([]), /No entry in the reference index covers this/);
});

test("the brief carries ids and sources so an answer can be checked", () => {
  const brief = buildReferenceBrief(findReferences("do I need a licence for a $600 job"));

  assert.match(brief, /\[LIC-THRESHOLD\]/);
  assert.match(brief, /leginfo\.legislature\.ca\.gov/);
  // The edition matters: an answer against the wrong code year is wrong.
  assert.match(brief, /2025 California Building Standards Code/);
  assert.match(brief, /2023 NEC/);
});

test("the prompt forbids the three things that would do real damage", () => {
  const prompt = referenceSystemPrompt();

  // A made-up article number gets a permit pulled against it.
  assert.match(prompt, /Never invent a code section/i);
  // Stating a licence number is unrecoverable — the source index says so.
  assert.match(prompt, /Never state a licence number/i);
  // Requirements are address-specific and the AHJ decides.
  assert.match(prompt, /address-specific/i);
  assert.ok(prompt.includes(REFERENCE_CAVEAT));
});

test("every entry is retrievable by its own title", () => {
  // An entry nothing can find is an entry that does not exist.
  for (const entry of REFERENCE_ENTRIES) {
    const found = findReferences(entry.title, 8).map((row) => row.id);
    assert.ok(found.includes(entry.id), `${entry.id} could not be found by its own title`);
  }
});

test("every entry has an id, a section, a title and detail", () => {
  for (const entry of REFERENCE_ENTRIES) {
    assert.ok(entry.id.trim().length > 0);
    assert.ok(entry.section.trim().length > 0);
    assert.ok(entry.title.trim().length > 0);
    assert.ok(entry.detail.trim().length > 20, entry.id);
  }
});

test("entry ids are unique", () => {
  const seen = REFERENCE_ENTRIES.map((entry) => entry.id);
  assert.equal(new Set(seen).size, seen.length);
});

test("results are capped so a brief cannot swamp the question", () => {
  assert.ok(findReferences("permit licence code inspection safety contract", 3).length <= 3);
});
