/**
 * Matching what a job needs against what the business already has.
 *
 * A materials list that shows everything as something to buy sends somebody to
 * Lowe's for a breaker they have four of on the van. That is the whole point of
 * this file: the list has to say which lines are already covered, which are
 * short and by how much, and which are genuinely a shopping trip.
 *
 * Matching is on names typed by two different people at two different times —
 * "20A AFCI breaker" on the job and "AFCI Breaker, 20 amp" in the stock list —
 * so it cannot be an equality check. It is also not fuzzy in the
 * edit-distance sense: a wrong match here means somebody drives to a job
 * without a part, which is worse than an unmatched line they can see and fix.
 *
 * Import-free, so the matching can be tested without a database.
 */

export type StockItem = {
  id: string;
  name: string;
  quantity: number;
  unit: string;
  partNumber?: string;
  location?: string;
};

export type RequiredMaterial = {
  name: string;
  quantity: number;
  unit: string;
};

export type MatchedMaterial = RequiredMaterial & {
  /** The stock row this was matched to, if any. */
  stock?: StockItem;
  /** How many are on hand, capped at what is needed. */
  inStock: number;
  /** How many still have to be bought. Zero means the job is covered. */
  shortfall: number;
};

/**
 * A name reduced to the words that identify a part.
 *
 * Punctuation, case and the noise words an electrician writes without thinking
 * ("amp" vs "a", plurals) all vary between the person who listed the job and
 * the person who stocked the van.
 */
export function normalizeName(value: string): string {
  return (
    (value ?? "")
      .toLowerCase()
      // Punctuation goes first, so "20-amp" and "20 amp" are the same string by
      // the time the unit spellings are folded. Doing it the other way round
      // left the hyphen in place and the two did not match.
      .replace(/[^a-z0-9]+/g, " ")
      // "20a", "20 amp" and "20-amp" are the same breaker.
      .replace(/(\d)\s*(?:a|amp|amps|ampere|amperes)\b/g, "$1amp")
      .replace(/(\d)\s*(?:v|volt|volts)\b/g, "$1volt")
      .replace(/(\d)\s*(?:ft|foot|feet)\b/g, "$1ft")
      .replace(/\s+/g, " ")
      .trim()
  );
}

/** The identifying words of a name, plurals folded, noise dropped. */
export function nameTokens(value: string): string[] {
  const NOISE = new Set(["the", "a", "an", "of", "and", "for", "with", "each"]);
  return normalizeName(value)
    .split(" ")
    .filter(Boolean)
    .map((word) => (word.length > 3 && word.endsWith("s") ? word.slice(0, -1) : word))
    .filter((word) => !NOISE.has(word));
}

/**
 * How well two names describe the same part, from 0 to 1.
 *
 * Every identifying word of the shorter name having a counterpart in the longer
 * one is what counts. "AFCI breaker 20A" against "20 amp AFCI breaker, Square D"
 * scores 1: the extra brand does not make it a different part.
 */
export function nameSimilarity(a: string, b: string): number {
  const left = nameTokens(a);
  const right = nameTokens(b);
  if (left.length === 0 || right.length === 0) return 0;

  const [shorter, longer] = left.length <= right.length ? [left, right] : [right, left];
  const pool = new Set(longer);
  const hits = shorter.filter((word) => pool.has(word)).length;

  return hits / shorter.length;
}

/**
 * How sure a match has to be.
 *
 * Set high deliberately. An unmatched line shows as "buy it", which somebody
 * reads and corrects; a wrong match shows as "you have it", which somebody
 * believes and then drives to a job without the part.
 */
export const MATCH_THRESHOLD = 0.8;

/** The stock row that best describes a required material, or nothing. */
export function findStock(
  required: RequiredMaterial,
  stock: StockItem[],
): StockItem | undefined {
  // A part number is an exact identity and beats any amount of name similarity.
  const requiredNormalized = normalizeName(required.name);

  let best: { item: StockItem; score: number } | undefined;

  for (const item of stock) {
    const partNumber = (item.partNumber ?? "").trim();
    if (partNumber && requiredNormalized.includes(normalizeName(partNumber))) {
      return item;
    }

    const score = nameSimilarity(required.name, item.name);
    if (score < MATCH_THRESHOLD) continue;
    // Ties go to the longer stock name, which is the more specific record.
    if (!best || score > best.score) best = { item, score };
  }

  return best?.item;
}

/**
 * A job's materials, annotated with what is already on hand.
 *
 * Units are compared but not converted. Fifty feet of cable against a stock row
 * counted in boxes is not something this can safely reconcile, and inventing a
 * conversion would produce a confident wrong answer — so a unit mismatch counts
 * as unmatched and shows as something to buy.
 */
export function matchMaterials(
  required: RequiredMaterial[],
  stock: StockItem[],
): MatchedMaterial[] {
  // Stock is consumed as the list is walked, so two lines needing the same part
  // do not both claim the same four breakers.
  const remaining = new Map(stock.map((item) => [item.id, item.quantity]));

  return required.map((line) => {
    const needed = Math.max(0, Number.isFinite(line.quantity) ? line.quantity : 0);
    const match = findStock(line, stock);

    const sameUnit =
      match && normalizeName(match.unit || "each") === normalizeName(line.unit || "each");

    if (!match || !sameUnit) {
      return { ...line, inStock: 0, shortfall: needed };
    }

    const available = Math.max(0, remaining.get(match.id) ?? 0);
    const used = Math.min(available, needed);
    remaining.set(match.id, available - used);

    return {
      ...line,
      stock: match,
      inStock: used,
      shortfall: Math.max(0, needed - used),
    };
  });
}

/** One line for the top of a materials list. */
export function describeCoverage(matched: MatchedMaterial[]): string {
  if (matched.length === 0) return "Nothing is needed for this job yet.";

  const short = matched.filter((line) => line.shortfall > 0);
  if (short.length === 0) {
    return `Everything for this job is already in stock — no supply stop needed.`;
  }
  if (short.length === matched.length) {
    return `None of these ${matched.length} are in stock.`;
  }

  const covered = matched.length - short.length;
  return `${covered} of ${matched.length} covered by stock. ${short.length} still to buy.`;
}
