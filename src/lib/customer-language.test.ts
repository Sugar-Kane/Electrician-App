import test from "node:test";
import assert from "node:assert/strict";

import {
  chooseLanguage,
  describeLanguageChoice,
  DEFAULT_LANGUAGE,
  isSupportedLanguage,
  languageLabel,
  readLanguage,
  readLanguageSource,
  resolveLanguage,
  SUPPORTED_LANGUAGES,
} from "./customer-language.ts";

test("the languages offered are the languages the column accepts", () => {
  // customers_preferred_language_check holds exactly these two. A third here
  // would be a choice that saves as a constraint violation.
  assert.deepEqual(
    SUPPORTED_LANGUAGES.map((entry) => entry.value).sort(),
    ["en", "es"],
  );
  assert.equal(DEFAULT_LANGUAGE, "en");
});

test("an owner's choice is never overwritten by a detection", () => {
  // The rule the whole feature rests on. The owner said this customer reads
  // English; one "gracias" must not undo that.
  const pinned = { language: "en", source: "owner" } as const;

  assert.equal(resolveLanguage(pinned, "es"), null);
  assert.equal(resolveLanguage(pinned, "en"), null);
});

test("a detected row is corrected by a later detection", () => {
  const guessed = { language: "en", source: "detected" } as const;

  assert.deepEqual(resolveLanguage(guessed, "es"), {
    language: "es",
    source: "detected",
  });
});

test("a detection that changes nothing writes nothing", () => {
  // Otherwise every inbound text is a database write for no reason.
  assert.equal(resolveLanguage({ language: "es", source: "detected" }, "es"), null);
});

test("a language this app does not speak leaves the customer alone", () => {
  // A Portuguese text is correctly detected as Portuguese, and there is no
  // Portuguese here. Falling back to English would undo a correct earlier
  // detection of Spanish, which is worse than doing nothing.
  const spanish = { language: "es", source: "detected" } as const;

  assert.equal(resolveLanguage(spanish, "pt"), null);
  assert.equal(resolveLanguage(spanish, ""), null);
  assert.equal(resolveLanguage(spanish, "gibberish"), null);
});

test("choosing always writes, and always marks it as the owner's", () => {
  assert.deepEqual(chooseLanguage("es"), { language: "es", source: "owner" });
  assert.deepEqual(chooseLanguage("en"), { language: "en", source: "owner" });

  // Even nonsense pins the row, because the owner did press something and the
  // pin is the point. It lands on the default rather than being refused.
  assert.deepEqual(chooseLanguage("klingon"), { language: "en", source: "owner" });
});

test("pinning then detecting is stable, which is the whole loop", () => {
  // Owner corrects a bad guess, then the customer sends more Spanish.
  const afterOwnerFix = chooseLanguage("en");
  assert.equal(resolveLanguage(afterOwnerFix, "es"), null);
  assert.equal(resolveLanguage(afterOwnerFix, "es"), null);
});

test("a column holding something unexpected reads as the default", () => {
  assert.equal(readLanguage("es"), "es");
  assert.equal(readLanguage("fr"), "en");
  assert.equal(readLanguage(null), "en");
  assert.equal(readLanguage(42), "en");

  assert.equal(readLanguageSource("owner"), "owner");
  assert.equal(readLanguageSource("detected"), "detected");
  assert.equal(readLanguageSource(null), "detected");
});

test("labels never show a bare code", () => {
  assert.equal(languageLabel("es"), "Spanish");
  assert.equal(languageLabel("en"), "English");
  assert.equal(languageLabel("zz"), "English");
  assert.equal(isSupportedLanguage("zz"), false);
});

test("the owner can tell a guess from their own choice", () => {
  // Without this they cannot tell whether changing it will stick.
  assert.match(describeLanguageChoice({ language: "es", source: "owner" }), /you set it/);
  assert.match(
    describeLanguageChoice({ language: "es", source: "detected" }),
    /picked up from how they write/,
  );
});
