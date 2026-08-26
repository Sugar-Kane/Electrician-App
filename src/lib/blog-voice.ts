/**
 * The house style for a work journal post, enforced rather than requested.
 *
 * Every rule here could be a line in a prompt, and every one of them would be
 * followed most of the time. Most of the time is not the bar for something that
 * publishes itself onto a licensed contractor's own domain with nobody reading
 * it first. So the prompt asks and this checks, and a draft that fails the check
 * does not become a post.
 *
 * The two kinds of failure are handled differently on purpose:
 *
 * - **Repairable.** An em dash has a correct replacement that can be worked out
 *   from the sentence around it, so `stripDashes` fixes them and nothing is
 *   rejected for one. Refusing a good post over a punctuation mark that code can
 *   fix is a worse outcome than the punctuation mark.
 * - **Not repairable.** "Delve into the world of electrical safety" cannot be
 *   mechanically rewritten into something a person would say. Those are
 *   reported, the model is told which phrases it used, and it gets one more go.
 *
 * Import-free, so the rules can be tested without a model.
 */

export type VoiceProblem = {
  kind: "tell" | "identity" | "claim" | "impersonal" | "length";
  /** Said the way it will be handed back to the model. */
  detail: string;
};

/* ------------------------------------------------------------------ dashes */

/*
 * A single spaced dash becomes a full stop, not a comma.
 *
 * A comma there is a splice, which is the thing a careful reader notices and
 * the exact impression this is trying to avoid. Two short sentences read *more*
 * like somebody talking, not less: "The breaker was doing its job. That is what
 * it is there for."
 *
 * The exceptions are where a full stop would leave a fragment — a very short
 * tail, or one starting with a word that cannot open a sentence.
 */
/*
 * `that` and `then` are the two that need care.
 *
 * "Then it went again." is a perfectly good sentence, so `then` is not here at
 * all. `that` is two different words: a relative pronoun that cannot open a
 * sentence ("the panel that we saw") and a demonstrative that can ("That is
 * what it is there for"). The lookahead tells them apart by what follows, which
 * is the only signal available without parsing.
 */
const CANNOT_OPEN_A_SENTENCE = new RegExp(
  "^(?:" +
    "(?:and|but|or|so|which|who|whom|whose|because|although|though|while|since|unless|until|whereas|yet|nor|plus)\\b" +
    "|that\\b(?!\\s+(?:is|was|are|were|will|would|should|can|could|means|makes|does|did|has|had|sounds|looks|matters|kind|sort))" +
    ")",
  "i",
);

const DASHES = "\\u2014\\u2013\\u2015";

function tailIsAFragment(tail: string): boolean {
  const trimmed = tail.trim();
  if (!trimmed) return true;
  if (CANNOT_OPEN_A_SENTENCE.test(trimmed)) return true;
  // Up to three words before the next stop is an aside, not a sentence.
  const words = trimmed.split(/\s+/);
  return words.length <= 3;
}

/**
 * Every em dash and its lookalikes, replaced with what was meant.
 *
 * Deterministic and always applied, so no draft is ever rejected for one. Also
 * covers the en dash and the horizontal bar, because a model told not to use an
 * em dash will reach for the next-longest line, and a double hyphen, which is
 * what a keyboard produces when somebody means one.
 *
 * A dash between two digits is a range and stays a range: "a 15-20 amp draw" is
 * not punctuation, and turning it into a sentence break would be nonsense.
 */
export function stripDashes(value: string): string {
  let text = value ?? "";

  // Ranges first, so the sentence rules below never see them.
  text = text.replace(new RegExp(`(\\d)\\s*[${DASHES}]\\s*(\\d)`, "g"), "$1-$2");
  text = text.replace(/(\d)\s*--\s*(\d)/g, "$1-$2");

  // A pair inside one sentence is a parenthetical, and commas are what it
  // means. Done before the single-dash rule, which would otherwise split the
  // sentence at the opening dash and strand the closing one.
  const paired = new RegExp(
    `([^.!?\\n]*?)\\s+[${DASHES}]\\s+([^.!?\\n]+?)\\s+[${DASHES}]\\s+([^.!?\\n]*)`,
    "g",
  );
  text = text.replace(paired, "$1, $2, $3");

  // What is left is a single break in a sentence.
  const single = new RegExp(`\\s*(?:[${DASHES}]|--)\\s*`, "g");
  text = text.replace(single, (match, offset: number, whole: string) => {
    const tail = whole.slice(offset + match.length).split(/(?<=[.!?])\s/)[0] ?? "";
    return tailIsAFragment(tail) ? ", " : ". ";
  });

  // The rule above may have opened a sentence mid-word-case.
  text = text.replace(/([.!?])\s+([a-z])/g, (_all, stop: string, letter: string) =>
    `${stop} ${letter.toUpperCase()}`,
  );

  // A dash left touching a word on one side only, which no rule above matched.
  text = text.replace(new RegExp(`[${DASHES}]`, "g"), ", ");

  return text.replace(/\s+([,.])/g, "$1").replace(/,\s*,/g, ",").replace(/[ \t]{2,}/g, " ");
}

/** Whether anything dash-shaped survives. Used by the tests, not the pipeline. */
export function hasDash(value: string): boolean {
  return new RegExp(`[${DASHES}]`).test(value ?? "");
}

/* -------------------------------------------------------------------- tells */

/*
 * Phrases that give the game away.
 *
 * Kept deliberately high-precision rather than exhaustive. A list that also
 * catches "ensure", "crucial" and "important" would reject drafts that are
 * fine, and a check that fires on everything is a check somebody turns off.
 * Every entry here is a phrase that reads as machine-written in this context
 * even when a human could technically have written it.
 */
const TELLS: { pattern: RegExp; phrase: string }[] = [
  { pattern: /\bdelve?s?\s+into\b/i, phrase: "delve into" },
  { pattern: /\bdiv(e|ing)\s+into\b/i, phrase: "dive into" },
  { pattern: /\bit(?:'|’)?s?\s+worth\s+noting\b/i, phrase: "it's worth noting" },
  { pattern: /\bin\s+today(?:'|’)?s\s+(fast-paced|modern|digital)\b/i, phrase: "in today's fast-paced" },
  { pattern: /\bnestled\b/i, phrase: "nestled" },
  { pattern: /\ba\s+testament\s+to\b/i, phrase: "a testament to" },
  { pattern: /\bwhen\s+it\s+comes\s+to\b/i, phrase: "when it comes to" },
  { pattern: /\bnavigat(e|ing)\s+the\s+(complexities|world|landscape)\b/i, phrase: "navigating the complexities" },
  { pattern: /\belevate\s+your\b/i, phrase: "elevate your" },
  { pattern: /\blook\s+no\s+further\b/i, phrase: "look no further" },
  { pattern: /\brest\s+assured\b/i, phrase: "rest assured" },
  { pattern: /\bat\s+the\s+end\s+of\s+the\s+day\b/i, phrase: "at the end of the day" },
  { pattern: /\bin\s+conclusion\b/i, phrase: "in conclusion" },
  { pattern: /\b(furthermore|moreover)\b/i, phrase: "furthermore / moreover" },
  { pattern: /\bthat\s+(being|said)\s+said\b/i, phrase: "that being said" },
  { pattern: /\bthe\s+world\s+of\s+\w+/i, phrase: "the world of" },
  { pattern: /\bunlock\s+(the|your)\b/i, phrase: "unlock the" },
  { pattern: /\bgame[-\s]changer\b/i, phrase: "game-changer" },
  { pattern: /\bseamless(ly)?\b/i, phrase: "seamless" },
  { pattern: /\bleverag(e|ing)\b/i, phrase: "leverage" },
  /*
   * The single most recognisable construction there is.
   *
   * The contraction is the awkward part: "isn't" has no space in it, so a
   * pattern written as `is` + whitespace + `not` matches "is not just" and sails
   * straight past the form people actually write.
   */
  {
    pattern: /\b(?:is|was|are|were)(?:n(?:'|’)?t|\s+not)\s+just\b[^.!?]{0,80}?,\s*it(?:'|’)?s\b/i,
    phrase: "it's not just X, it's Y",
  },
  { pattern: /\bnot\s+only\b[^.!?]{1,80}?\bbut\s+also\b/i, phrase: "not only X but also Y" },
  { pattern: /\bwhether\s+you(?:'|’)?re\s+a\b[^.!?]{1,60}?\bor\s+a\b/i, phrase: "whether you're a X or a Y" },
];

/**
 * The same phrases, for the prompt to forbid up front.
 *
 * Exported so `journal-prompt` builds its rule from this list rather than
 * repeating it. Two copies would drift the first time one was extended, and the
 * failure mode of that drift is silent: a model rejected for a phrase nobody
 * ever told it not to use, retrying with the same phrase, and producing no post.
 */
export const TELL_PHRASES: string[] = TELLS.map((tell) => tell.phrase);

/**
 * Something a person did not write, if there is any.
 *
 * Returns every match rather than the first, because the retry hands the list
 * back and a model told about one phrase will produce a draft containing the
 * next.
 */
export function findTells(value: string): string[] {
  const found = new Set<string>();
  for (const tell of TELLS) if (tell.pattern.test(value ?? "")) found.add(tell.phrase);
  return [...found];
}

/* ------------------------------------------------------------- the whole pass */

/*
 * Claims a lesson post is not entitled to make.
 *
 * A post written from a job with no technician notes says what causes a fault
 * and what gets checked. It cannot say what was found or what was done, because
 * nobody wrote that down and inventing it is a claim about electrical work
 * performed at a real address.
 *
 * `we got a call about` is fine and stays fine. It is the outcome verbs that
 * are the problem.
 */
/*
 * The gap between "we" and the verb is deliberate, and was found by running
 * this over a real draft rather than by reading it.
 *
 * The first version required them adjacent, so "we replaced the breaker" was
 * caught and "we went out and found a loose neutral" sailed through. The second
 * is the same claim with five words in the middle, and it is the one a model
 * actually writes.
 *
 * Bounded to one sentence, so "we explained what causes it. A loose lug is
 * often found in older panels" is not read as a claim about this job.
 */
const OUTCOME_VERBS =
  "replaced|installed|repaired|rewired|swapped|fixed|found|traced|discovered|tightened|corrected|re-?terminated|upgraded|pinpointed|located";

const OUTCOME_CLAIMS = new RegExp(
  [
    `\\bwe\\b[^.!?]{0,60}?\\b(?:${OUTCOME_VERBS})\\b`,
    "\\bturned\\s+out\\s+to\\s+be\\b",
    "\\bthe\\s+(?:culprit|cause|fault|problem)\\s+(?:was|turned)\\b",
    // "It was a loose neutral." An outcome with no subject at all.
    "\\bit\\s+was\\s+(?:a|an|the)\\s+\\w+",
  ].join("|"),
  "i",
);

/** A post nobody is in. The "personal touch" this is meant to have. */
const FIRST_PERSON = /\b(we|our|us)\b/i;

export const MIN_WORDS = 220;
export const MAX_WORDS = 1300;

export function wordCount(value: string): number {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

/**
 * Run the whole house style over a draft.
 *
 * Repairs first, then reports. The returned text is what would be published;
 * the problems are what stops it being published, and each one is worded so it
 * can be handed straight back to the model.
 *
 * `forbidden` is the belt to the braces of never passing the model a customer's
 * name in the first place. It cannot write a name it was never given, and this
 * catches the case where it was given one by accident.
 */
export function houseStyle(input: {
  text: string;
  kind: "story" | "lesson";
  forbidden?: string[];
}): { text: string; problems: VoiceProblem[] } {
  const text = stripDashes(input.text ?? "");
  const problems: VoiceProblem[] = [];

  const tells = findTells(text);
  if (tells.length > 0) {
    problems.push({
      kind: "tell",
      detail: `These read as machine-written. Say it another way: ${tells.join(", ")}.`,
    });
  }

  for (const word of input.forbidden ?? []) {
    const term = word.trim();
    // Two characters is a street-number fragment, not a name, and matching on
    // one would reject every post containing the letter it happens to be.
    if (term.length < 3) continue;
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    /*
     * A trailing plural or possessive still identifies somebody.
     *
     * `\bHenderson\b` does not match "the Hendersons": the "s" is a word
     * character, so there is no boundary after the name, and the whole check
     * silently passes on the most natural way to write a family's name. Found
     * by a test rather than by reading the regex.
     */
    if (new RegExp(`\\b${escaped}(?:['\u2019]s|es|s)?\\b`, "i").test(text)) {
      problems.push({
        kind: "identity",
        detail: `"${term}" identifies the customer and must not appear.`,
      });
    }
  }

  if (input.kind === "lesson" && OUTCOME_CLAIMS.test(text)) {
    problems.push({
      kind: "claim",
      detail:
        "Nobody wrote down what was found or done on this job, so the post cannot say. Explain what causes the fault and what an electrician checks, without claiming an outcome.",
    });
  }

  if (!FIRST_PERSON.test(text)) {
    problems.push({
      kind: "impersonal",
      detail: "Nobody is in this. Write it as the business talking: we, us, our.",
    });
  }

  const words = wordCount(text);
  if (words < MIN_WORDS) {
    problems.push({ kind: "length", detail: `Too short at ${words} words. Aim past ${MIN_WORDS}.` });
  } else if (words > MAX_WORDS) {
    problems.push({ kind: "length", detail: `Too long at ${words} words. Keep it under ${MAX_WORDS}.` });
  }

  return { text, problems };
}

/** The problems, worded as one instruction for a second attempt. */
export function retryNote(problems: VoiceProblem[]): string {
  return problems.map((problem) => `- ${problem.detail}`).join("\n");
}

/** The four fields a post is made of, as they are written and as they publish. */
export type PostFields = { title: string; dek: string; body: string; lesson: string };

/**
 * The house style over a whole post, not over the parts of it people read most.
 *
 * The first version checked `body` and `lesson` for identifiers and ran the
 * title and the dek through only for dash repair, throwing their problems away.
 * A name in the title would have published — and the title is also the URL, the
 * browser tab, the OpenGraph card and the structured data, so it is the single
 * worst field to leak in.
 *
 * Every field is repaired individually so they stay separate, and all four are
 * checked together so a problem cannot hide in whichever one nobody looked at.
 */
export function checkPost(input: {
  post: PostFields;
  kind: "story" | "lesson";
  forbidden?: string[];
}): { post: PostFields; problems: VoiceProblem[] } {
  const repair = (value: string) =>
    houseStyle({ text: value, kind: input.kind }).text.trim();

  const post: PostFields = {
    title: repair(input.post.title),
    dek: repair(input.post.dek),
    body: repair(input.post.body),
    lesson: repair(input.post.lesson),
  };

  const { problems } = houseStyle({
    text: [post.title, post.dek, post.body, post.lesson].join("\n\n"),
    kind: input.kind,
    forbidden: input.forbidden,
  });

  return { post, problems };
}
