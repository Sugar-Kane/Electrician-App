/**
 * How a contract's text is broken up, wherever it is laid out.
 *
 * The PDF and the copy on the customer's signing page both read the body
 * through here, so the two cannot disagree about where a paragraph ends or
 * which lines are set as headings — the copy somebody reads on their phone is
 * the document the business files, at a size a phone can show.
 *
 * Import-free, so it can be tested without a renderer.
 */

export type ContractBlock = { text: string; heading: boolean };

/**
 * A line that is acting as a heading.
 *
 * Short, no trailing full stop, and either all caps or title case followed by a
 * colon — which is how every contract template in the wild writes one. Guessing
 * wrong only changes a weight, never the words.
 */
export function looksLikeHeading(line: string): boolean {
  const trimmed = line.trim();
  if (trimmed.length === 0 || trimmed.length > 60) return false;
  if (/[.,;]$/.test(trimmed)) return false;
  return trimmed === trimmed.toUpperCase() || /^[A-Z][^.!?]*:$/.test(trimmed);
}

/**
 * The body as blocks, split where the template leaves a blank line.
 *
 * Blank lines separate paragraphs, which is how the template is written and how
 * it has always been shown. Runs of them collapse into one break, so a template
 * with generous spacing does not produce a mostly empty second page. A template
 * pasted from Word arrives with Windows line endings, which are read the same.
 */
export function contractBlocks(body: string): ContractBlock[] {
  return (body ?? "")
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((text) => ({ text, heading: looksLikeHeading(text) }));
}
