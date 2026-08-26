import test from "node:test";
import assert from "node:assert/strict";

import { localeFor, phrasesFor } from "./intake-phrases.ts";
import { INTAKE_QUESTIONS } from "./sms-intake.ts";
import { SUPPORTED_LANGUAGES } from "./customer-language.ts";

const CODES = SUPPORTED_LANGUAGES.map((entry) => entry.value);

test("every language the app offers has a full set of words", () => {
  // A language in the picker with no phrase set behind it is a customer who
  // gets English, silently, after being told they would not.
  const english = phrasesFor("en");

  for (const code of CODES) {
    const set = phrasesFor(code);
    assert.deepEqual(
      Object.keys(set).sort(),
      Object.keys(english).sort(),
      `${code} is missing phrases`,
    );
  }
});

test("every intake question is asked in every language", () => {
  // `nextIntakeQuestion` falls back to the English wording for a key nobody
  // translated, which is the right failure — but it is a failure, so it is
  // worth knowing about here rather than discovering it in somebody's thread.
  for (const code of CODES) {
    const { questions } = phrasesFor(code);
    for (const { key } of INTAKE_QUESTIONS) {
      assert.ok(questions[key], `${code} has no question for ${key}`);
    }
  }
});

test("STOP is never translated", () => {
  // A carrier keyword, not ours. Twilio's 21610 is the carrier's own opt-out
  // list, so a Spanish word in its place reads like an opt-out and does not
  // opt anybody out.
  for (const code of CODES) {
    assert.match(phrasesFor(code).optOut, /\bSTOP\b/, code);
  }
});

test("a language nobody built falls back rather than throwing", () => {
  // This runs inside a Twilio webhook. A thrown error is a customer who gets
  // no reply at all, which is worse than a reply in the wrong language.
  assert.equal(phrasesFor("pt").optOut, phrasesFor("en").optOut);
  assert.equal(phrasesFor("").optOut, phrasesFor("en").optOut);
});

test("the Spanish set is actually Spanish", () => {
  // Guards the copy-paste that leaves an English sentence in the Spanish
  // object, which type-checks perfectly and reads as a bug to one customer.
  const es = phrasesFor("es");

  assert.match(es.opening("Acme"), /problema eléctrico/);
  assert.match(es.booked("Acme", "hoy", "555"), /reservado/);
  assert.match(es.offer("Acme", "hoy", "$180"), /diagnóstico/);
  assert.match(es.noOpening("Acme"), /horario/);
  assert.match(es.questions.breaker!, /panel de breakers/);

  for (const built of [
    es.opening("Acme"),
    es.askAddress("Acme"),
    es.callback("Acme", "Ana", false),
    es.messageTaken("Acme"),
    es.noOpening("Acme"),
  ]) {
    assert.doesNotMatch(built, /\b(the|your|what|call you back|thanks)\b/i, built);
  }
});

test("the business name leads every reply", () => {
  // A text from an unrecognised number saying "we can come Tuesday" is a text
  // somebody deletes. The name is what makes it legible on a lock screen.
  for (const code of CODES) {
    const set = phrasesFor(code);
    for (const built of [
      set.opening("Acme"),
      set.askAddress("Acme"),
      set.askProblemAndAddress("Acme"),
      set.callback("Acme", "", false),
      set.offer("Acme", "today", "$180"),
      set.haveWindow("Acme", "today"),
      set.noOpening("Acme"),
      set.booked("Acme", "today", "555"),
      set.messageTaken("Acme"),
      set.holding("Acme", "today"),
    ]) {
      assert.ok(built.startsWith("Acme"), `${code}: ${built}`);
    }
  }
});

test("a locale, not a language code, reaches Intl", () => {
  // "es" alone formats times as 8:00-10:00; a Spanish speaker in California
  // reads 8:00 a.m., which is what the regional locale gives.
  assert.equal(localeFor("es"), "es-US");
  assert.equal(localeFor("en"), "en-US");
  assert.equal(localeFor("pt"), "en-US");
});
