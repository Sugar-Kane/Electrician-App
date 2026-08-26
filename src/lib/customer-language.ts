/**
 * Which language a customer is written to in, and who decided.
 *
 * The second half is the one that matters. Detecting a language from a text
 * message is a guess: "ok gracias" from an English speaker is one word of
 * Spanish, and a business whose customers are mostly bilingual will throw off
 * plenty of those. A guess that keeps overwriting the owner's correction is
 * worse than no detection at all — they fix it, the next message flips it
 * back, and they stop trusting the setting entirely.
 *
 * So every row records who chose. Detection may only write over a row detection
 * itself chose; a row the owner set is final until the owner changes it.
 *
 * Import-free, so the rule can be tested without a database or a model.
 */

export const SUPPORTED_LANGUAGES = [
  { value: "en", label: "English" },
  { value: "es", label: "Spanish" },
] as const;

export type LanguageCode = (typeof SUPPORTED_LANGUAGES)[number]["value"];

/** Who chose the language on a customer's record. */
export type LanguageSource = "detected" | "owner";

export const DEFAULT_LANGUAGE: LanguageCode = "en";

const CODES = new Set<string>(SUPPORTED_LANGUAGES.map((entry) => entry.value));

export function isSupportedLanguage(value: string): value is LanguageCode {
  return CODES.has(value);
}

/** What a language reads as. Falls back rather than showing a bare code. */
export function languageLabel(value: string): string {
  return SUPPORTED_LANGUAGES.find((entry) => entry.value === value)?.label ?? "English";
}

/** A stored value made safe, for a column that could hold anything historic. */
export function readLanguage(value: unknown): LanguageCode {
  return typeof value === "string" && isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE;
}

export function readLanguageSource(value: unknown): LanguageSource {
  return value === "owner" ? "owner" : "detected";
}

export type LanguageState = { language: LanguageCode; source: LanguageSource };

/**
 * What to store after a message arrives in some language.
 *
 * Returns null when nothing should be written, which is most of the time — the
 * language usually has not changed, and a write per inbound text is a write per
 * inbound text.
 *
 * The three rules, in the order they matter:
 *
 * - **An owner's choice is never overwritten.** This is the override, and it is
 *   enforced here rather than at each call site, because a rule that lives in
 *   four places is a rule that holds in three.
 * - An unsupported or unreadable detection changes nothing. A model returning
 *   "pt" for a Portuguese text is right, and this app has no Portuguese, so the
 *   honest outcome is to leave the customer where they were rather than to fall
 *   back to English and undo a correct earlier detection.
 * - Otherwise a detection is adopted, and stays marked as a detection so the
 *   next one may correct it.
 */
export function resolveLanguage(
  current: LanguageState,
  detected: string,
): LanguageState | null {
  if (current.source === "owner") return null;
  if (!isSupportedLanguage(detected)) return null;
  if (detected === current.language) return null;

  return { language: detected, source: "detected" };
}

/**
 * What the owner picked, ready to store.
 *
 * Separate from `resolveLanguage` on purpose: this one always writes, and it
 * always marks the row as the owner's, which is what stops the next inbound
 * message undoing it.
 */
export function chooseLanguage(value: string): LanguageState {
  return {
    language: isSupportedLanguage(value) ? value : DEFAULT_LANGUAGE,
    source: "owner",
  };
}

/**
 * How to say, in one line, why a customer is getting the language they are.
 *
 * Shown beside the control. "Spanish" alone invites the question this answers,
 * and an owner who cannot tell a detection from their own choice cannot tell
 * whether changing it will stick.
 */
export function describeLanguageChoice(state: LanguageState): string {
  const label = languageLabel(state.language);
  return state.source === "owner"
    ? `${label}, because you set it. Messages will not switch on their own.`
    : `${label}, picked up from how they write. Set it yourself to pin it.`;
}
