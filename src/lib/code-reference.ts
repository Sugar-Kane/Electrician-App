/**
 * Finding the entries that answer a question.
 *
 * Keyword scoring rather than embeddings, deliberately. The index is a few
 * dozen entries written in the vocabulary electricians already use, the
 * questions are short, and a scoring function whose behaviour can be read and
 * tested is worth more here than a slightly better recall curve. It also runs
 * with no network call and no second model.
 *
 * Import-free, so retrieval can be tested without a model.
 */

import {
  REFERENCE_CAVEAT,
  REFERENCE_ENTRIES,
  REFERENCE_RULES,
  CODE_EDITION,
  type ReferenceEntry,
} from "./code-reference-data.ts";

export { REFERENCE_CAVEAT, CODE_EDITION };
export type { ReferenceEntry };

const STOP_WORDS = new Set([
  "the", "a", "an", "of", "and", "or", "for", "with", "to", "in", "on", "is", "are",
  "do", "does", "did", "i", "we", "you", "my", "our", "it", "this", "that", "what",
  "when", "how", "can", "need", "needed", "any", "be", "am", "if", "at", "by", "from",
  "should", "would", "have", "has", "there", "about", "who", "whom", "me", "not",
  "was", "were", "been", "get", "got", "use", "using", "one", "some", "all", "no",
]);

/**
 * The least a match can score and still be one.
 *
 * A single incidental body word is not a match. "Who has not paid me" hitting
 * the word "who" inside a licensing entry is how a question about unpaid
 * invoices comes back with an answer about qualifying persons — and an
 * assistant that answers legal questions it was not asked is worse than one
 * that stays quiet.
 */
const MINIMUM_SCORE = 3;

export function terms(value: string): string[] {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .split(" ")
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word))
    // Fold simple plurals so "permits" finds "permit".
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word));
}

function fieldTerms(entry: ReferenceEntry): {
  id: string[];
  title: string[];
  keywords: string[];
  body: string[];
} {
  return {
    id: terms(entry.id),
    title: terms(entry.title),
    keywords: terms((entry.keywords ?? []).join(" ")),
    body: terms(`${entry.section} ${entry.detail}`),
  };
}

/**
 * How well an entry answers a question.
 *
 * Weighted by where the word appears. A word in the keywords was put there by
 * somebody predicting this exact question; a word in the body might be
 * incidental.
 */
export function scoreEntry(question: string, entry: ReferenceEntry): number {
  const asked = terms(question);
  if (asked.length === 0) return 0;

  const fields = fieldTerms(entry);
  let score = 0;

  for (const word of asked) {
    // An entry id typed verbatim ("LIC-C10") is somebody asking for that entry.
    if (fields.id.includes(word)) score += 12;
    if (fields.keywords.includes(word)) score += 5;
    if (fields.title.includes(word)) score += 3;
    else if (fields.body.includes(word)) score += 1;
  }

  return score;
}

/** The entries worth putting in front of the model, best first. */
export function findReferences(question: string, limit = 6): ReferenceEntry[] {
  const scored = REFERENCE_ENTRIES.map((entry) => ({ entry, score: scoreEntry(question, entry) }))
    .filter((row) => row.score >= MINIMUM_SCORE)
    .sort((a, b) => b.score - a.score);

  return scored.slice(0, limit).map((row) => row.entry);
}

/**
 * Whether a question is asking about code, licensing or permits at all.
 *
 * Used to decide whether to spend a retrieval on it. "What is booked tomorrow"
 * should not drag in the asbestos standard.
 */
export function looksLikeCodeQuestion(question: string): boolean {
  return findReferences(question, 1).length > 0;
}

/** The matched entries, as text for the model, with their sources attached. */
export function buildReferenceBrief(entries: ReferenceEntry[]): string {
  if (entries.length === 0) {
    return "No entry in the reference index covers this question.";
  }

  return [
    CODE_EDITION,
    "",
    ...entries.map((entry) =>
      [
        `[${entry.id}] ${entry.section} — ${entry.title}`,
        entry.detail,
        entry.source ? `Source: ${entry.source}` : "",
      ]
        .filter(Boolean)
        .join("\n"),
    ),
  ].join("\n\n");
}

export function referenceSystemPrompt(): string {
  return [
    "You answer questions about California and federal electrical code, licensing, permits and inspections for a working electrician.",
    "",
    "You are given entries from a reference index below. They are the only authority you have.",
    "",
    "Rules:",
    ...REFERENCE_RULES.map((rule) => `- ${rule}`),
  ].join("\n");
}
