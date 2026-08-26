import test from "node:test";
import assert from "node:assert/strict";

import {
  deidentify,
  describeSource,
  readJournalSource,
  readsAsTestData,
  postSlug,
  seasonOf,
  soundsElectrical,
  streetIdentifiers,
} from "./journal-source.ts";

/*
 * The two jobs that actually exist.
 *
 * Copied from production rather than invented, because the whole design of this
 * module came from reading them. Job 9 is the only completed job in the system
 * and has no technician notes at all; job 5 is live test data with an offensive
 * one-liner in the description field. If either of these ever produces the
 * wrong answer, somebody publishes something on a licensed contractor's own
 * domain with nobody in between.
 */
const JOB_9 = {
  customerDescription:
    "my dryer isn't operating correctly. It just shut off randomly and I have to keep resetting the breaker.",
  aiSummary: null,
  technicianNotes: null,
  categoryLabel: "Diagnostic",
  town: "Nipomo",
  state: "CA",
  completedAt: "2026-08-12T17:23:21.960Z",
  parts: [],
  identifiers: [],
};

const JOB_5 = {
  customerDescription: "He's gay",
  technicianNotes: "Test test test test Can you hear me hello hello Papa",
  categoryLabel: "Diagnostic",
  town: "Nipomo",
  state: "Ca",
  completedAt: "2026-08-11T23:24:15.991Z",
};

test("the only completed job in production is a lesson, never a story", () => {
  // It has a real complaint and nothing written about what was done. A story
  // here would be an invented repair at a real address.
  const source = readJournalSource(JOB_9);

  assert.ok(source);
  assert.equal(source.kind, "lesson");
  assert.equal(source.work, "");
  assert.equal(source.town, "Nipomo");
  assert.equal(source.state, "CA");
  assert.match(source.complaint, /resetting the breaker/);
});

test("the junk job produces no post at all", () => {
  // Auto-publish plus this input is an offensive post on the business's own
  // domain. Declining is a first-class outcome, not an error.
  assert.equal(readJournalSource(JOB_5), null);
});

test("junk notes demote a job to a lesson rather than declining it", () => {
  // The complaint is real; the dictation test is not. Without this the
  // generator treats "Can you hear me hello hello Papa" as a written-up repair.
  const source = readJournalSource({
    ...JOB_9,
    technicianNotes: "Test test test test Can you hear me hello hello Papa",
  });

  assert.ok(source);
  assert.equal(source.kind, "lesson");
  assert.equal(source.work, "");
});

test("real notes make it a story", () => {
  const source = readJournalSource({
    ...JOB_9,
    technicianNotes:
      "Dryer circuit was pulling 26A on a 30A breaker. Breaker itself was warm to touch and the lug was loose. Retorqued to spec, watched a full cycle, held steady.",
  });

  assert.ok(source);
  assert.equal(source.kind, "story");
  assert.match(source.work, /Retorqued to spec/);
});

test("parts alone are enough to tell the story", () => {
  // Somebody who itemised the job wrote down what they did, even if they never
  // typed a note.
  const source = readJournalSource({ ...JOB_9, parts: ["30A double pole breaker", "2 hours labor"] });

  assert.ok(source);
  assert.equal(source.kind, "story");
  assert.deepEqual(source.parts, ["30A double pole breaker", "2 hours labor"]);
});

test("a complaint with nothing electrical in it is not a post", () => {
  // A positive test rather than a blocklist. Asking "is this a description of
  // an electrical problem" fails closed; listing things people should not have
  // typed fails open and needs maintaining forever.
  assert.equal(readJournalSource({ ...JOB_9, customerDescription: "He's gay" }), null);
  assert.equal(
    readJournalSource({ ...JOB_9, customerDescription: "asdkjhasd kjahsd kjahsd kjh" }),
    null,
  );
  assert.equal(
    readJournalSource({ ...JOB_9, customerDescription: "please call me back tomorrow morning" }),
    null,
  );
});

test("a complaint too short to describe anything is not a post", () => {
  assert.equal(readJournalSource({ ...JOB_9, customerDescription: "no power" }), null);
  assert.equal(readJournalSource({ ...JOB_9, customerDescription: "" }), null);
  assert.equal(readJournalSource({ ...JOB_9, customerDescription: null }), null);
});

test("the AI summary stands in when the customer said nothing", () => {
  const source = readJournalSource({
    ...JOB_9,
    customerDescription: null,
    aiSummary: "Customer reports the kitchen outlets are dead after a storm; breaker will not reset.",
  });

  assert.ok(source);
  assert.match(source.complaint, /kitchen outlets are dead/);
});

test("an address the customer typed themselves does not reach the brief", () => {
  // The one field where a street can turn up without anybody putting it there.
  // "I'm at 412 Tefft and the kitchen is dead" is an ordinary thing to text.
  const source = readJournalSource({
    ...JOB_9,
    customerDescription:
      "I'm at 412 Tefft Street and the kitchen outlets are dead, breaker keeps tripping. Call me on (805) 555-0142 or maria@example.com.",
    identifiers: ["Maria", "Tefft"],
  });

  assert.ok(source);
  assert.doesNotMatch(source.complaint, /412|Tefft|555-0142|example\.com/i);
  // What is left is still the actual complaint.
  assert.match(source.complaint, /kitchen outlets are dead/);
  assert.match(source.complaint, /breaker keeps tripping/);
});

test("what must not appear is carried forward for the draft to be checked against", () => {
  const source = readJournalSource({ ...JOB_9, identifiers: ["Maria", "Tefft", "R"] });

  assert.ok(source);
  // A one-letter identifier would reject every post containing that letter.
  assert.deepEqual(source.forbidden, ["Maria", "Tefft"]);
});

test("the season is vaguer than a date", () => {
  assert.equal(seasonOf("2026-08-03T00:00:00Z"), "early August");
  assert.equal(seasonOf("2026-08-15T00:00:00Z"), "the middle of August");
  assert.equal(seasonOf("2026-08-27T00:00:00Z"), "late August");
  assert.equal(seasonOf("not a date"), "");
});

test("a lesson brief tells the model outright what it may not say", () => {
  // Belt and braces with `houseStyle`. A model that has to infer "there are no
  // notes, so claim no outcome" will infer it most of the time.
  const brief = describeSource(readJournalSource(JOB_9)!);

  assert.match(brief, /Kind of post: lesson/);
  assert.match(brief, /Nothing was written down/);
  assert.match(brief, /Do not say what the fault turned out to be/);
  assert.match(brief, /a home in Nipomo, CA/);
});

test("a story brief carries the work and the parts", () => {
  const brief = describeSource(
    readJournalSource({
      ...JOB_9,
      technicianNotes: "Loose lug on the dryer breaker. Retorqued to spec.",
      parts: ["30A double pole breaker"],
    })!,
  );

  assert.match(brief, /Kind of post: story/);
  assert.match(brief, /Retorqued to spec/);
  assert.match(brief, /- 30A double pole breaker/);
  assert.doesNotMatch(brief, /Nothing was written down/);
});

test("no brief ever contains a name, a street, a phone or a job number", () => {
  // The property this whole module exists for, asserted on the thing that is
  // actually sent rather than on an intermediate value.
  const brief = describeSource(
    readJournalSource({
      ...JOB_9,
      customerDescription:
        "Maria here at 412 Tefft Street, breaker keeps tripping, reach me at 805-555-0142.",
      technicianNotes: "Loose lug at the dryer breaker on Maria's panel. Retorqued.",
      identifiers: ["Maria", "Tefft"],
    })!,
  );

  for (const secret of ["Maria", "Tefft", "412", "555-0142"]) {
    assert.doesNotMatch(brief, new RegExp(secret, "i"), `${secret} survived: ${brief}`);
  }
});

test("the vocabulary check knows a word from a fragment", () => {
  assert.equal(soundsElectrical("the breaker keeps tripping"), true);
  assert.equal(soundsElectrical("my dryer shut off"), true);
  // "ac" inside "vacuum" must not count, or anything gets through.
  assert.equal(soundsElectrical("the vacuum is broken and the placard fell off"), false);
  assert.equal(soundsElectrical(""), false);
});

test("test data is recognised without a list of things people should not type", () => {
  assert.equal(readsAsTestData("Test test test test Can you hear me hello hello Papa"), true);
  assert.equal(readsAsTestData("hello hello hello"), true);
  assert.equal(readsAsTestData("testing one two three"), true);
  assert.equal(readsAsTestData(""), true);
  assert.equal(
    readsAsTestData("Breaker was warm. Retorqued the lug and watched a full cycle."),
    false,
  );
});

test("de-identifying leaves readable prose behind", () => {
  // A brief full of holes is a brief the model writes around badly. Taking the
  // address has to take the preposition it was hanging off with it, or the
  // sentence reads "I live at and the lights flicker".
  assert.equal(
    deidentify("I live at 12 Oak Lane and the lights flicker.", []),
    "I live and the lights flicker.",
  );
  assert.equal(deidentify("Call 805-555-0142 please.", []), "Call please.");
  assert.equal(deidentify("", []), "");
});

test("the slug is the question, which is the URL that should rank", () => {
  assert.equal(
    postSlug("Why does my dryer keep tripping the breaker?"),
    "why-does-my-dryer-keep-tripping-the-breaker",
  );
  // An apostrophe joins rather than splits: "wont" beats "won-t".
  assert.equal(postSlug("My GFCI won't reset"), "my-gfci-wont-reset");
});

test("the same title always gives the same slug", () => {
  // A regenerated post that landed at a second address would leave the first
  // one indexed and orphaned.
  const title = "Why is half my kitchen dead?";
  assert.equal(postSlug(title), postSlug(title));
});

test("a slug is never empty and never ends in a hyphen", () => {
  assert.equal(postSlug(""), "work-journal");
  assert.equal(postSlug("???"), "work-journal");
  assert.equal(postSlug("Breaker!!!"), "breaker");

  const long = postSlug("why ".repeat(60));
  assert.ok(long.length <= 80, `${long.length} characters`);
  assert.doesNotMatch(long, /-$/);
});

test("accents fold rather than making a second URL", () => {
  assert.equal(postSlug("¿Por qué se bota el breaker?"), "por-que-se-bota-el-breaker");
});

test("a street named after an ordinary word does not censor the post", () => {
  /*
   * The best catch of the review, and it would have been invisible until a
   * customer on Water Street reported a wet outlet. Every token of the address
   * became a forbidden term, so "water" was stripped from their own complaint
   * and any draft containing it was refused — including one using this app's
   * own diagram label, "Through a person or into water".
   */
  assert.deepEqual(streetIdentifiers("88 Water Street"), []);
  assert.deepEqual(streetIdentifiers("14 Power Ave"), []);
  assert.deepEqual(streetIdentifiers("6 Well Road"), []);
  assert.deepEqual(streetIdentifiers("12 Park Lane"), []);
  assert.deepEqual(streetIdentifiers("900 North Church Street"), []);
});

test("the distinctive part of a street is still guarded", () => {
  // The case the list exists for. "Tefft" names one street in one town.
  assert.deepEqual(streetIdentifiers("412 Tefft Street"), ["Tefft"]);
  assert.deepEqual(streetIdentifiers("77 Hilldale Ct, Apt 4"), ["Hilldale"]);
  assert.deepEqual(streetIdentifiers(""), []);
});

test("a complaint about water survives a customer who lives on Water Street", () => {
  // End to end: the wet-GFCI post that would have been refused twice.
  const source = readJournalSource({
    ...JOB_9,
    customerDescription:
      "Water is getting into the outlet by the pool and the breaker keeps tripping.",
    identifiers: streetIdentifiers("88 Water Street"),
  });

  assert.ok(source);
  assert.match(source.complaint, /Water is getting into the outlet/);
  assert.deepEqual(source.forbidden, []);
});
