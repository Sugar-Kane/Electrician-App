import test from "node:test";
import assert from "node:assert/strict";

import {
  MAX_WORDS,
  MIN_WORDS,
  americanize,
  checkPost,
  findTells,
  hasDash,
  houseStyle,
  retryNote,
  stripDashes,
  wordCount,
} from "./blog-voice.ts";

/** Enough words to clear the length floor without saying anything. */
const PADDING = `We ${"checked the panel and the circuit again and again ".repeat(30)}`;

test("an em dash between two clauses becomes two sentences", () => {
  // A comma there is a splice, which is exactly the thing a careful reader
  // notices. Two short sentences read more like somebody talking.
  assert.equal(
    stripDashes("The breaker was doing its job — that is what it is there for."),
    "The breaker was doing its job. That is what it is there for.",
  );
});

test("a short tail becomes a comma rather than a fragment", () => {
  // "Every time. " on its own is not a sentence.
  assert.equal(
    stripDashes("It tripped again — every time."),
    "It tripped again, every time.",
  );
});

test("a tail that cannot open a sentence becomes a comma", () => {
  assert.equal(
    stripDashes("We looked at the dryer circuit — because that is where the load is."),
    "We looked at the dryer circuit, because that is where the load is.",
  );
  assert.equal(
    stripDashes("She reset it twice — and it went again."),
    "She reset it twice, and it went again.",
  );
});

test("a pair of dashes is a parenthetical, so both become commas", () => {
  // The single-dash rule alone would split at the opening dash and leave the
  // closing one stranded mid-sentence.
  const fixed = stripDashes("The panel — a 1970s Zinsco — was the first thing we looked at.");
  assert.equal(fixed, "The panel, a 1970s Zinsco, was the first thing we looked at.");
  assert.ok(!hasDash(fixed));
});

test("a range between digits stays a range", () => {
  // "a 15. 20 amp draw" would be nonsense. This is not punctuation.
  assert.equal(stripDashes("a 15–20 amp draw"), "a 15-20 amp draw");
  assert.equal(stripDashes("the 8–10am window"), "the 8-10am window");
});

test("the lookalikes are caught too", () => {
  // A model told not to use an em dash reaches for the next longest line, and a
  // keyboard produces a double hyphen when somebody means one.
  for (const draft of [
    "It held – then it did not.",
    "It held ― then it did not.",
    "It held -- then it did not.",
  ]) {
    const fixed = stripDashes(draft);
    assert.ok(!hasDash(fixed), draft);
    assert.doesNotMatch(fixed, /--/, draft);
    assert.equal(fixed, "It held. Then it did not.");
  }
});

test("nothing dash-shaped survives a realistic paragraph", () => {
  // The check that matters, because the rules above each handle one case and
  // real prose arrives with several in one breath.
  const draft =
    "The dryer kept cutting out — the homeowner had been resetting the breaker " +
    "two or three times a load — which is the part that worried us. A breaker " +
    "that trips is not broken – it is doing the one job it has. We measured a " +
    "22–24 amp draw on a 30 amp circuit, so the load itself was fine.";

  const fixed = stripDashes(draft);
  assert.ok(!hasDash(fixed), fixed);
  assert.match(fixed, /22-24 amp/);
  // The parenthetical collapsed to commas rather than shattering the sentence.
  assert.match(fixed, /cutting out, the homeowner/);
});

test("the phrases that give the game away are named, not just counted", () => {
  // The retry hands the list back, and a model told about one will produce a
  // draft containing the next.
  const found = findTells(
    "Let's delve into the world of breakers. It's worth noting that this is a game-changer.",
  );

  assert.ok(found.includes("delve into"), found.join());
  assert.ok(found.includes("the world of"), found.join());
  assert.ok(found.includes("it's worth noting"), found.join());
  assert.ok(found.includes("game-changer"), found.join());
});

test("the most recognisable construction there is", () => {
  assert.deepEqual(
    findTells("A breaker isn't just a switch, it's a safety device."),
    ["it's not just X, it's Y"],
  );
});

test("ordinary trade writing is not rejected", () => {
  // A check that fires on everything is a check somebody turns off. None of
  // these is a tell, and all of them are how an electrician actually writes.
  assert.deepEqual(
    findTells(
      "We checked the panel first. The breaker was warm, which usually means a loose " +
        "lug or a circuit carrying more than it should. It is important to make sure the " +
        "connection is tight, so we torqued it to spec and watched it under load.",
    ),
    [],
  );
});

test("a lesson post may say who called but not what was found", () => {
  // Nobody wrote down what happened on this job. A post that says anyway is a
  // claim about electrical work performed at a real address.
  const said = houseStyle({
    kind: "lesson",
    text: `We got a call about a dryer that kept shutting off mid-cycle. ${PADDING}`,
  });
  assert.deepEqual(said.problems, []);

  const claimed = houseStyle({
    kind: "lesson",
    text: `We got a call about a dryer. We found a loose neutral in the panel. ${PADDING}`,
  });
  assert.ok(claimed.problems.some((problem) => problem.kind === "claim"), "the claim passed");
});

test("the same sentence is the point of a story post", () => {
  const told = houseStyle({
    kind: "story",
    text: `We got a call about a dryer. We found a loose neutral in the panel. ${PADDING}`,
  });
  assert.deepEqual(told.problems, []);
});

test("a customer's name never reaches the page", () => {
  // The braces to the belt of never handing the model a name at all.
  const leaked = houseStyle({
    kind: "story",
    text: `We went out to Maria's place on Tefft Street. ${PADDING}`,
    forbidden: ["Maria", "Tefft"],
  });

  const identity = leaked.problems.filter((problem) => problem.kind === "identity");
  assert.equal(identity.length, 2);
  assert.match(identity[0]!.detail, /identifies the customer/);
});

test("a one-letter forbidden term does not reject every post", () => {
  // A street number split into fragments would otherwise match a letter and
  // refuse everything that contains it.
  const fine = houseStyle({ kind: "story", text: PADDING, forbidden: ["a", "St", ""] });
  assert.deepEqual(fine.problems.filter((problem) => problem.kind === "identity"), []);
});

test("a post with nobody in it is not a post with a personal touch", () => {
  const impersonal = houseStyle({
    kind: "lesson",
    text: `A breaker that trips is doing its job. ${"The circuit is carrying more than it should carry. ".repeat(30)}`,
  });

  assert.ok(impersonal.problems.some((problem) => problem.kind === "impersonal"));
});

test("length is checked at both ends", () => {
  const short = houseStyle({ kind: "lesson", text: "We looked at it. It was fine." });
  assert.ok(short.problems.some((problem) => problem.kind === "length"));
  assert.match(short.problems.find((problem) => problem.kind === "length")!.detail, /Too short/);

  const long = houseStyle({ kind: "lesson", text: `We ${"word ".repeat(MAX_WORDS + 50)}` });
  assert.match(long.problems.find((problem) => problem.kind === "length")!.detail, /Too long/);

  assert.ok(MIN_WORDS < MAX_WORDS);
  assert.equal(wordCount("  "), 0);
  assert.equal(wordCount("one two three"), 3);
});

test("the dashes are repaired even when the draft is rejected for something else", () => {
  // Repair first, report second. A returned text that still had em dashes in it
  // would put them back into the retry the model is asked to improve on.
  const result = houseStyle({
    kind: "lesson",
    text: "Let us delve into breakers — they matter.",
  });

  assert.ok(!hasDash(result.text), result.text);
  assert.ok(result.problems.some((problem) => problem.kind === "tell"));
});

test("the problems come back as something a model can act on", () => {
  const note = retryNote(
    houseStyle({ kind: "lesson", text: "We delve into it." }).problems,
  );

  assert.match(note, /^- /m);
  assert.match(note, /delve into/);
  assert.match(note, /Too short/);
});

test("a claim survives words between the subject and the verb", () => {
  /*
   * Found by running the pipeline over a real draft rather than by reading the
   * regex. The first version required "we" next to the verb, so "we replaced
   * the breaker" was caught and this, which is the same claim and the one a
   * model actually writes, was not.
   */
  const sneaky = houseStyle({
    kind: "lesson",
    text: `We went out to the house and found a loose neutral in the panel. ${PADDING}`,
  });

  assert.ok(sneaky.problems.some((problem) => problem.kind === "claim"), sneaky.text);
});

test("an outcome with no subject at all is still an outcome", () => {
  const bare = houseStyle({
    kind: "lesson",
    text: `The breaker kept going. It was a loose lug on the dryer circuit. ${PADDING}`,
  });

  assert.ok(bare.problems.some((problem) => problem.kind === "claim"));
});

test("explaining what is usually wrong is not claiming what was wrong", () => {
  // The false positive that would make a lesson post impossible to write. The
  // claim check is bounded to one sentence for exactly this.
  const explaining = houseStyle({
    kind: "lesson",
    text:
      "We get called about this a few times a month. A loose lug is often found in older panels, " +
      `and a breaker that trips under load is usually telling the truth about the load. ${PADDING}`,
  });

  assert.deepEqual(explaining.problems, [], JSON.stringify(explaining.problems));
});

test("a name in the title is caught, not just one in the body", () => {
  /*
   * The gap a reviewer found. The first version checked `body` and `lesson`
   * for identifiers and ran the title and dek through for dash repair alone,
   * throwing their problems away. The title is also the URL, the browser tab,
   * the OpenGraph card and the structured data, so it is the worst field to
   * leak in and the one that was unchecked.
   */
  const leaked = checkPost({
    post: {
      title: "What we found at the Hendersons' place",
      dek: "A dryer that kept tripping.",
      body: `We got a call about a dryer. ${PADDING}`,
      lesson: "Stop resetting it and get somebody to look.",
    },
    kind: "story",
    forbidden: ["Henderson"],
  });

  assert.ok(
    leaked.problems.some((problem) => problem.kind === "identity"),
    JSON.stringify(leaked.problems),
  );
});

test("a name in the dek is caught too", () => {
  const leaked = checkPost({
    post: {
      title: "Why does my dryer trip the breaker?",
      dek: "What we found on Tefft Street.",
      body: `We got a call about a dryer. ${PADDING}`,
      lesson: "Get somebody to look.",
    },
    kind: "story",
    forbidden: ["Tefft"],
  });

  assert.ok(leaked.problems.some((problem) => problem.kind === "identity"));
});

test("every field is repaired, not only the ones that are checked", () => {
  const repaired = checkPost({
    post: {
      title: "A breaker — and what it does",
      dek: "It trips — every time.",
      body: `We looked at it — twice. ${PADDING}`,
      lesson: "Reset it once — no more.",
    },
    kind: "story",
  });

  for (const [field, value] of Object.entries(repaired.post)) {
    assert.ok(!hasDash(value), `${field}: ${value}`);
  }
});

test("a clean post passes the whole-post check", () => {
  const fine = checkPost({
    post: {
      title: "Why does my dryer keep tripping the breaker?",
      dek: "A breaker that trips is doing its job.",
      body: `We got a call about a dryer that kept shutting off. ${PADDING}`,
      lesson: "If it trips twice in a week, get somebody to look at it.",
    },
    kind: "lesson",
    forbidden: ["Henderson", "Tefft"],
  });

  assert.deepEqual(fine.problems, [], JSON.stringify(fine.problems));
});

test("British spellings are repaired, not rejected", () => {
  // The one that actually published, in the sentence it published in.
  assert.equal(
    americanize("whether there is any discolouration on it or the busbar behind it"),
    "whether there is any discoloration on it or the busbar behind it",
  );

  assert.equal(americanize("the neighbour's meter"), "the neighbor's meter");
  assert.equal(americanize("a 3 metre run of aluminium"), "a 3 meter run of aluminum");
  assert.equal(americanize("grey mould in the centre"), "gray mold in the center");
  assert.equal(americanize("we recognised the behaviour"), "we recognized the behavior");

  // Not a spelling. The British word for grounding, which on a page a homeowner
  // reads while looking at their own panel is worse than a misspelling.
  assert.equal(americanize("the earthing conductor"), "the grounding conductor");
  assert.equal(americanize("it was properly earthed"), "it was properly grounded");
});

test("ordinary words that merely look British are left alone", () => {
  /*
   * The reason this is a table and not an `-our` rule. Every word here would
   * have been mangled in public by the obvious regex.
   */
  const safe = "Four of your hours, a pour of flour, a sour tour of the earth and our meter.";
  assert.equal(americanize(safe), safe);

  // "earth" on its own is an ordinary English word and stays one.
  assert.equal(americanize("the earth around the rod"), "the earth around the rod");
});

test("a repaired spelling keeps the case it was written in", () => {
  assert.equal(americanize("Discolouration around the outlet"), "Discoloration around the outlet");
  assert.equal(americanize("COLOUR"), "COLOR");
  assert.equal(americanize("colour"), "color");
});

test("houseStyle repairs spelling the same pass it repairs dashes", () => {
  // Both repairs, one call, and neither reported as a problem to retry on.
  const { text, problems } = houseStyle({
    text: "We saw discolouration — the breaker was warm.",
    kind: "lesson",
  });

  assert.ok(text.includes("discoloration"));
  assert.equal(hasDash(text), false);
  assert.equal(problems.some((problem) => problem.kind === "tell"), false);
});
