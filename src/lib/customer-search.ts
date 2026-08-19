/**
 * Finding the customer somebody is half-way through typing.
 *
 * Search runs as they type, so the ranking is the whole feature: the right
 * customer has to be in the first two or three rows before the name is
 * finished. Get it wrong and somebody concludes the customer is not in the
 * system and creates them a second time — which is the failure this is written
 * to prevent, and the one that costs the most to undo.
 *
 * Import-free, because every interesting case is a string: a phone number typed
 * with dashes against one stored without, a surname that is somebody else's
 * first name, "Main" matching two hundred addresses on Main Street.
 */

export type Searchable = {
  id: string;
  name: string;
  phone: string;
  email: string;
  /** Service address, already flattened to one line. */
  address: string;
};

/**
 * Digits only.
 *
 * "(432) 555-1234", "432-555-1234" and "+14325551234" are one number written
 * three ways, and a customer found by none of them is a customer somebody
 * enters again.
 */
export function digitsOf(value: string): string {
  return value.replace(/\D+/g, "");
}

/** Enough digits to mean a phone number rather than a house number. */
const PHONE_DIGITS = 3;

/**
 * How well a record answers a query, 0 for not at all.
 *
 * The scale is ordinal, not a probability: what matters is that a name beats an
 * address, the start of a name beats the middle of one, and a phone number
 * beats everything when the query is clearly a phone number.
 */
export function matchScore(record: Searchable, query: string): number {
  const needle = query.trim().toLowerCase();
  if (!needle) return 0;

  const name = record.name.toLowerCase();
  const email = record.email.toLowerCase();
  const address = record.address.toLowerCase();

  const typedDigits = digitsOf(needle);
  const phoneDigits = digitsOf(record.phone);

  // A run of digits is somebody reading a number off a phone screen. It is the
  // most certain thing anybody types, so it outranks a name match.
  if (typedDigits.length >= PHONE_DIGITS && phoneDigits.includes(typedDigits)) {
    return phoneDigits.startsWith(typedDigits) ? 100 : 90;
  }

  const words = name.split(/\s+/);

  if (name.startsWith(needle)) return 85;
  // A whole surname typed out is a more certain answer than a longer name that
  // happens to begin with it: "smith" should put Smith above Smithers, and only
  // a word match does that.
  if (words.includes(needle)) return 82;
  // "smith" should find "John Smith" as readily as "john" does. A surname is a
  // word in the middle of the name, and only a word-start counts — otherwise
  // "ith" finds Smith and the list fills with noise.
  if (words.some((word) => word.startsWith(needle))) return 80;
  if (name.includes(needle)) return 60;

  if (email.startsWith(needle)) return 55;
  // Three characters before an address counts. "12" is inside half the house
  // numbers ever written, and matching it turns the first keystrokes of a phone
  // number into a list of everybody on the street.
  if (needle.length >= 3 && address.includes(needle)) return 50;
  if (email.includes(needle)) return 40;

  return 0;
}

/**
 * The matches, best first.
 *
 * Ties break by name so the order is stable between keystrokes — a list that
 * reshuffles under a thumb is a list nobody can tap.
 */
export function rankCustomers(
  records: Searchable[],
  query: string,
  limit = 8,
): Searchable[] {
  return records
    .map((record) => ({ record, score: matchScore(record, query) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.record.name.localeCompare(b.record.name))
    .slice(0, limit)
    .map((entry) => entry.record);
}

/**
 * Whether what somebody typed is a question rather than a name.
 *
 * The same box does both, so this is the line between "show me matches" and
 * "the assistant should answer this". Deliberately conservative: a wrong guess
 * towards search costs a wasted glance, a wrong guess towards the assistant
 * costs a model call and a pause.
 */
export function looksLikeAQuestion(query: string): boolean {
  const text = query.trim().toLowerCase();
  if (!text) return false;
  if (text.endsWith("?")) return true;

  // Four words is past a name and an address line, and into a sentence.
  if (text.split(/\s+/).length >= 4) return true;

  return /^(who|what|when|where|which|why|how|show|list|find all|tell me|does|do|is|are|can)\b/.test(
    text,
  );
}
