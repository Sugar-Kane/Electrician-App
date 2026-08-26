import test from "node:test";
import assert from "node:assert/strict";

import { MAX_WORDS, MIN_WORDS, TELL_PHRASES } from "./blog-voice.ts";
import { DIAGRAMS } from "./journal-diagrams.ts";
import { journalSystemPrompt } from "./journal-prompt.ts";

const prompt = journalSystemPrompt({
  businessName: "Pacific Plains Electric",
  city: "Santa Maria",
  state: "CA",
});

test("the model is told about every phrase it will be rejected for", () => {
  // The drift this guards against is silent and expensive: a phrase added to
  // the checker but not the prompt gets a draft rejected for something nobody
  // told the model, and the retry uses it again.
  for (const phrase of TELL_PHRASES) {
    assert.ok(prompt.includes(phrase), `the prompt never mentions "${phrase}"`);
  }
});

test("the length asked for is inside the length allowed", () => {
  // Asking for more words than `houseStyle` accepts is a rejection loop that
  // cannot converge.
  const asked = prompt.match(/Between (\d+) and (\d+) words/);
  assert.ok(asked, "the prompt does not state a length");

  const floor = Number(asked[1]);
  const ceiling = Number(asked[2]);
  assert.ok(floor > MIN_WORDS, `asks for ${floor}, rejects under ${MIN_WORDS}`);
  assert.ok(ceiling < MAX_WORDS, `asks for ${ceiling}, rejects over ${MAX_WORDS}`);
});

test("every diagram in the catalogue is offered", () => {
  // A diagram the model is never shown is a diagram that is never used.
  for (const spec of DIAGRAMS) assert.ok(prompt.includes(spec.key), spec.key);
});

test("the two kinds of post are told apart in words", () => {
  // The single most consequential instruction here. A lesson post that claims
  // an outcome is a statement about electrical work at a real address.
  assert.match(prompt, /Do NOT say what it turned out to be/);
  assert.match(prompt, /Do NOT describe a repair/);
  assert.match(prompt, /may say a customer called about it/);
});

test("the customer is out of bounds, said outright", () => {
  assert.match(prompt, /Never name, describe or locate the customer/);
  assert.match(prompt, /Never quote a price/);
  assert.match(prompt, /not a homeowner job/);
});

test("no em dashes, including in the prompt itself", () => {
  // Writing the rule with the punctuation it forbids would be a demonstration
  // of the opposite.
  assert.doesNotMatch(prompt, /[—―]/);
  assert.match(prompt, /No em dashes/);
});

test("the business it is writing for is named", () => {
  assert.match(prompt, /Pacific Plains Electric/);
  assert.match(prompt, /Santa Maria, CA/);
});
