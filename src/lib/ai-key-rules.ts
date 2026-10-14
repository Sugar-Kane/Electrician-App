/**
 * The rules for a business's own OpenAI (ChatGPT) API key, before it is stored
 * or shown.
 *
 * The key is a password to somebody's paid account. Once saved it is never
 * shown again, anywhere: the screen says only which key it is by its last four
 * characters, the way a bank shows a card.
 *
 * Import-free, so it can be tested without a database or the network.
 */

/** "sk-…" or "sk-proj-…", one line, no spaces. */
export function looksLikeOpenAiKey(value: string): boolean {
  return /^sk-[A-Za-z0-9_-]{20,300}$/.test(value);
}

/** What a saved key is known by on screen: its last four characters, nothing more. */
export function keyHint(key: string): string {
  const tail = key.trim().slice(-4);
  return tail.length === 4 ? `…${tail}` : "…";
}

/**
 * The model to run the materials list on, from the ones this key can use: the
 * newest full GPT model ("gpt-5.2" over "gpt-5"), else the newest mini, else a
 * known older one. Audio, realtime, image and other specialised variants are
 * never picked, since they cannot write a list.
 */
export function pickOpenAiModel(ids: readonly string[]): string | null {
  const version = (id: string, pattern: RegExp) => {
    const match = id.match(pattern);
    return match ? Number(match[1]) : null;
  };
  const newest = (pattern: RegExp) =>
    ids
      .map((id) => ({ id, v: version(id, pattern) }))
      .filter((entry): entry is { id: string; v: number } => entry.v !== null && Number.isFinite(entry.v))
      .sort((a, b) => b.v - a.v)[0]?.id ?? null;

  return (
    newest(/^gpt-(\d+(?:\.\d+)?)$/) ??
    newest(/^gpt-(\d+(?:\.\d+)?)-mini$/) ??
    ["gpt-4.1", "gpt-4o", "gpt-4o-mini"].find((id) => ids.includes(id)) ??
    null
  );
}

/** A provider's refusal, as the owner should read it, without echoing the key. */
export function describeKeyRefusal(status: number, message: string): string {
  const said = message.replace(/sk-[A-Za-z0-9_-]+/g, "[key]").slice(0, 200);
  if (status === 401) return "OpenAI did not accept that key. Check it was copied whole, and that it has not been revoked.";
  if (status === 429) return `OpenAI refused the request: ${said || "the account is over its limit or out of credit"}.`;
  if (status === 403) return `OpenAI refused the request: ${said || "this key cannot use that model"}.`;
  return `OpenAI could not be reached (${status || "no answer"}). ${said}`.trim();
}
