/**
 * The small amount of markdown a chat reply actually contains.
 *
 * The model writes `**#5**` and the bubble rendered it with the asterisks
 * showing, which reads as a bug to anybody using it — and it is one.
 *
 * Not a markdown parser. Replies are short and use bold, occasional inline
 * code, and bullet lines; a full parser would be a dependency and an
 * injection surface for text a model produces. Anything not recognised is left
 * exactly as written, so an unhandled construct degrades to plain text rather
 * than disappearing.
 *
 * Import-free, so the parsing can be tested without React.
 */

export type Segment = { text: string; bold?: boolean; code?: boolean };
export type Line = { segments: Segment[]; bullet: boolean };

const TOKEN = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/g;

/** One line, split into plain and emphasised runs. */
export function parseSegments(line: string): Segment[] {
  const segments: Segment[] = [];
  let index = 0;

  for (const match of line.matchAll(TOKEN)) {
    const start = match.index ?? 0;
    if (start > index) segments.push({ text: line.slice(index, start) });

    const token = match[0];
    if (token.startsWith("**")) {
      segments.push({ text: token.slice(2, -2), bold: true });
    } else {
      segments.push({ text: token.slice(1, -1), code: true });
    }
    index = start + token.length;
  }

  if (index < line.length) segments.push({ text: line.slice(index) });
  // A line with no markup is still one segment, so callers never special-case
  // the empty result.
  return segments.length > 0 ? segments : [{ text: line }];
}

export function parseChatMarkdown(value: string): Line[] {
  return (value ?? "").split("\n").map((raw) => {
    const bullet = /^\s*[-*•]\s+/.test(raw);
    const text = bullet ? raw.replace(/^\s*[-*•]\s+/, "") : raw;
    return { segments: parseSegments(text), bullet };
  });
}

/**
 * The heading text of a paragraph that is one, and "" for everything else.
 *
 * A model writes its section headings as `**Like this**` alone on a line, and
 * rendering that as a paragraph containing a run of bold text is literally
 * correct and structurally wrong: a 700 word article came out with one `<h1>`,
 * one `<h2>` for the takeaway block, and no outline whatsoever in between.
 * Headings are what a crawler reads for structure and what a search snippet
 * gets pulled from, so a heading has to be a heading.
 *
 * Deliberately narrow, because a bolded sentence inside prose is not a section
 * heading: one line, every run bold, short, not a bullet, and not closed with a
 * full stop the way a sentence is.
 */
export function headingOf(lines: Line[], limit = 80): string {
  if (lines.length !== 1) return "";

  const [line] = lines;
  if (line.bullet || line.segments.length === 0) return "";
  if (!line.segments.every((segment) => segment.bold)) return "";

  const text = line.segments.map((segment) => segment.text).join("").trim();
  if (!text || text.length > limit || text.endsWith(".")) return "";
  return text;
}
