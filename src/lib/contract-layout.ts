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

/**
 * A paragraph without the line breaks its author made only because their line
 * was full, for a screen whose line is shorter than theirs.
 *
 * Templates arrive wrapped by hand at about eighty characters — the starter
 * template is, and so is every contract made from it. The PDF's line is longer
 * than that, so it shows those breaks as written and they read as a paragraph.
 * A phone's is about half as long, and every sentence broke twice, once where
 * the screen ran out and again where the author's line had, leaving "approval."
 * on a line of its own.
 *
 * A break goes only where the sentence plainly carries on: the next line starts
 * in lower case, or starts with a number after a line ending in a short word
 * ("work at" / "48 Pine St"), and the line before is prose long enough to have
 * been wrapped — not a heading, not a short item in a list, not a lead-in
 * ending in a colon. A list keeps its lines, and so does anything else. The
 * words are never changed: a break becomes a space.
 */
export function unwrapped(paragraph: string): string {
  const lines = paragraph.split("\n");
  let text = lines[0] ?? "";
  for (let index = 1; index < lines.length; index++) {
    const before = lines[index - 1].trimEnd();
    const line = lines[index];
    const start = line.trimStart();
    const prose = before.length >= 30 && /\p{Ll}/u.test(before) && !/[:;]$/.test(before);
    const listItem = /^(?:\p{Ll}{1,3}|\d+)[.)]\s/u.test(start) || /^[-–—•*]\s/.test(start);
    const carriesOn = /^\p{Ll}/u.test(start) || (/^\d/.test(start) && /(?:^|\s)\p{Ll}{1,4}$/u.test(before));
    text += prose && carriesOn && !listItem ? ` ${line}` : `\n${line}`;
  }
  return text;
}

export type SignatureSection = {
  /** Whether the block appears at all. */
  show: boolean;
  heading: string;
  /** What is said above the signature lines, in order. */
  lines: string[];
};

/**
 * What the signature block says, and whether there is one.
 *
 * Unsigned, it is left out when the business's own text already has somewhere
 * to sign — two blank places to sign is a customer signing in the wrong one.
 * Once anybody has signed, it always appears, as the record of who signed and
 * when: the business first, when it sends the contract, then the customer.
 */
export function signatureSection(input: {
  /** The business's template already ends with its own signing lines. */
  ownSignatures: boolean;
  businessName: string;
  customer?: { name: string; signedLabel: string };
  contractor?: { name: string; title: string; signedLabel: string };
}): SignatureSection {
  const { customer, contractor, ownSignatures } = input;
  const signed = Boolean(customer || contractor);
  const lines: string[] = [];

  // The invitation to sign, while there is still somebody to sign here.
  if (!customer && !ownSignatures) {
    lines.push("By signing below both parties agree to the work and the price set out above.");
  }
  if (contractor) {
    const signer = contractor.title ? `${contractor.name}, ${contractor.title}` : contractor.name;
    lines.push(`Signed for ${input.businessName || "the business"} by ${signer} on ${contractor.signedLabel}.`);
  }
  if (customer) {
    lines.push(`Signed electronically by ${customer.name} on ${customer.signedLabel}.`);
  }

  return {
    show: !ownSignatures || signed,
    heading: signed && ownSignatures ? "SIGNED ELECTRONICALLY" : "SIGNATURES",
    lines,
  };
}
