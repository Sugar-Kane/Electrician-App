/**
 * Whether a contract's own text already ends with somewhere to sign.
 *
 * This exists because the document grew a signature block and most real
 * contracts already have one. A business pastes in the agreement its lawyer
 * wrote, that agreement ends with "Customer signature: ______", and printing our
 * block underneath produces a page with two places to sign — which is not an
 * untidy document, it is a document signed in the wrong place.
 *
 * Deliberately strict. Missing a signing line and printing a second block is
 * untidy; seeing one that is not there means the contract has nowhere to sign at
 * all, which is worse. So both signals have to be present: the word, and the
 * space left for the pen.
 *
 * Import-free, so the awkward cases can be tested without rendering a PDF.
 */

/** Long enough to be a ruled line rather than a redaction or a divider. */
const RULE = /_{8,}|\.{12,}/;

const SIGNING_WORD = /\b(signature|signatures|signed by|sign here|undersigned)\b/i;

export function bodyProvidesSignatures(body: string): boolean {
  const text = body ?? "";
  if (!SIGNING_WORD.test(text)) return false;

  // The rule has to be on the signing line or immediately under it, and the
  // signing line has to read as a label rather than a sentence. Without the
  // second half, "This agreement is signed by both parties." followed by a row
  // of underscores used as a divider counts as a place to sign, and the contract
  // prints with nowhere to put a pen.
  const lines = text.replace(/\r\n/g, "\n").split("\n");

  return lines.some((line, index) => {
    if (!SIGNING_WORD.test(line)) return false;

    // "Customer signature: ______________  Date: ______" — label and rule
    // together, which is how most of them are written.
    if (RULE.test(line)) return true;

    // "Signed by the undersigned:" with the rule a line or two below. A label,
    // not prose: short, and not a finished sentence.
    const trimmed = line.trim();
    const isLabel = trimmed.length <= 60 && !/[.!?]$/.test(trimmed);
    if (!isLabel) return false;

    return [lines[index + 1] ?? "", lines[index + 2] ?? ""].some((nearby) => RULE.test(nearby));
  });
}
