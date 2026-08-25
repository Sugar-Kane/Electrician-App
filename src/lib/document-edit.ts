import { invoiceTotals, type InvoiceTotals } from "./invoice-math.ts";

/**
 * Changing a document the app produced.
 *
 * A generated document is not a file to be edited — it is a picture of a
 * record, rebuilt whenever the record changes. So editing one means editing
 * what it is a picture of, and the rules that matter are about which parts of
 * that record may move and when.
 *
 * Three of them, and each exists because of a specific way this goes wrong:
 *
 * - **A contract's terms are not the assistant's to touch.** Only the scope of
 *   work is, and it is enforced by construction rather than by instruction: the
 *   edit replaces one recorded passage and cannot name any other.
 * - **Nothing is editable once somebody outside the business holds a copy.** A
 *   sent invoice quietly changing its figures is the customer's copy and the
 *   business's copy disagreeing, and only one of them is in the room during the
 *   argument.
 * - **Totals are derived, never typed.** An invoice whose subtotal contradicts
 *   its own line table is worse than one that is simply wrong, because it is
 *   wrong in a way that reads as deliberate.
 *
 * Import-free apart from the arithmetic it deliberately reuses, so all of it
 * can be tested without a database.
 */

export type EditVerdict = { ok: true } | { ok: false; because: string };

/**
 * Whether an invoice may still be changed.
 *
 * Three checks where one would nearly do, and the redundancy is the point. The
 * status is a label somebody can set back to draft; `lastSentAt` is a fact
 * about a copy already in a customer's inbox. When they disagree, the one that
 * records something having actually happened wins.
 */
export function canEditInvoice(invoice: {
  status: string;
  lastSentAt: string | null;
  paidAt: string | null;
}): EditVerdict {
  if (invoice.paidAt) {
    return {
      ok: false,
      because:
        "That invoice has been paid, so its figures cannot change. Raise a new invoice for the difference, or a credit if they have overpaid.",
    };
  }

  if (invoice.lastSentAt) {
    return {
      ok: false,
      because:
        "That invoice has already gone to the customer. Changing it now would leave them holding different figures from yours — raise a corrected invoice instead.",
    };
  }

  if (invoice.status !== "draft") {
    return {
      ok: false,
      because: `That invoice is ${readableInvoiceStatus(invoice.status)}, so it is no longer a draft to edit. Raise a new one instead.`,
    };
  }

  return { ok: true };
}

function readableInvoiceStatus(status: string): string {
  if (status === "partially_paid") return "part paid";
  if (status === "void") return "voided";
  if (status === "overdue") return "overdue";
  if (status === "sent") return "sent";
  if (status === "paid") return "paid";
  return status || "not a draft";
}

/**
 * Whether a contract may still be changed.
 *
 * Today every contract is a draft and signing is a printed block on paper, so
 * this refuses nothing. It is the guard being right in advance: the column
 * already accepts `sent` and `signed`, and the first contract to reach either
 * must not be quietly rewritten underneath somebody's signature.
 */
export function canEditContract(contract: { status: string }): EditVerdict {
  if (contract.status === "signed") {
    return {
      ok: false,
      because:
        "That contract has been signed. A signed agreement is amended in writing, not edited — draft a new one alongside it.",
    };
  }

  if (contract.status === "sent") {
    return {
      ok: false,
      because:
        "That contract has already gone to the customer. Send a replacement rather than changing the copy they are reading.",
    };
  }

  if (contract.status === "void") {
    return { ok: false, because: "That contract has been voided." };
  }

  return { ok: true };
}

/**
 * Replace the scope passage inside a contract body, and nothing else.
 *
 * The body is the filled template, kept verbatim so the document can be
 * reproduced years later. The scope is recorded separately precisely so this
 * function can find it — an exact substring, put there by substitution, not
 * searched for by shape.
 *
 * Returns null rather than guessing whenever it cannot be certain:
 *
 * - no recorded scope, so there is no passage to replace;
 * - the recorded scope is not in the body verbatim, which means the body was
 *   changed by hand and splicing would corrupt it;
 * - the scope appears more than once, where replacing "the" occurrence is not a
 *   thing that exists.
 *
 * Failing closed here is the whole safety story. A splice that lands in the
 * wrong place edits the terms, which is the one outcome this must never have.
 */
export function spliceScope(
  body: string,
  oldScope: string,
  newScope: string,
): string | null {
  const passage = (oldScope ?? "").trim();
  const replacement = (newScope ?? "").trim();
  if (!body || !passage || !replacement) return null;

  const first = body.indexOf(passage);
  if (first === -1) return null;
  if (body.indexOf(passage, first + passage.length) !== -1) return null;

  return body.slice(0, first) + replacement + body.slice(first + passage.length);
}

export type DiffRow = { kind: "same" | "added" | "removed"; text: string };

/**
 * What changed, line by line, for reading before approving.
 *
 * A prefix and suffix match around a single changed middle, which is all this
 * needs: an edit here replaces one passage, so the interesting part is
 * contiguous by construction. A full longest-common-subsequence would produce a
 * prettier diff for edits this cannot make.
 *
 * The reason it exists at all: legal text approved without being read is the
 * failure a confirmation step is supposed to prevent, and "the assistant
 * rewrote your contract, tap OK" is not something anybody can meaningfully
 * check.
 */
export function diffLines(before: string, after: string): DiffRow[] {
  const from = (before ?? "").split("\n");
  const to = (after ?? "").split("\n");

  let head = 0;
  while (head < from.length && head < to.length && from[head] === to[head]) head += 1;

  let tail = 0;
  while (
    tail < from.length - head &&
    tail < to.length - head &&
    from[from.length - 1 - tail] === to[to.length - 1 - tail]
  ) {
    tail += 1;
  }

  const rows: DiffRow[] = [];
  for (let index = 0; index < head; index += 1) {
    rows.push({ kind: "same", text: from[index]! });
  }
  for (let index = head; index < from.length - tail; index += 1) {
    rows.push({ kind: "removed", text: from[index]! });
  }
  for (let index = head; index < to.length - tail; index += 1) {
    rows.push({ kind: "added", text: to[index]! });
  }
  for (let index = to.length - tail; index < to.length; index += 1) {
    rows.push({ kind: "same", text: to[index]! });
  }

  return rows;
}

export type InvoiceLine = {
  kind: "labor" | "material";
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
};

const MAX_DESCRIPTION = 300;
const MAX_UNIT = 24;
/** Enough for the longest real job; short enough that a runaway list is refused. */
export const MAX_INVOICE_LINES = 40;

/**
 * One line as the assistant proposed it, made safe.
 *
 * Null for a line with no description, which is not a line. Everything else is
 * clamped rather than rejected: a quantity of zero is a line that bills nothing
 * and is better shown as 0 in the review than silently dropped.
 */
export function readInvoiceLine(raw: unknown): InvoiceLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const description =
    typeof row.description === "string" ? row.description.trim().slice(0, MAX_DESCRIPTION) : "";
  if (!description) return null;

  const quantity = Number(row.quantity);
  const price = Number(row.unit_price_cents ?? row.unitPriceCents);
  // American spelling, because that is what job_line_items_kind_check accepts.
  const kind = row.kind === "material" ? "material" : "labor";

  return {
    kind,
    description,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 100) / 100 : 1,
    unit:
      (typeof row.unit === "string" ? row.unit.trim().slice(0, MAX_UNIT) : "") ||
      (kind === "labor" ? "hour" : "each"),
    unitPriceCents: Number.isFinite(price) && price > 0 ? Math.round(price) : 0,
  };
}

/** What the lines come to, before credit and tax. */
export function linesSubtotalCents(lines: InvoiceLine[]): number {
  return lines.reduce(
    (sum, line) => sum + Math.round(line.quantity * line.unitPriceCents),
    0,
  );
}

/**
 * The invoice's figures, worked out from its lines.
 *
 * Nothing writes a total directly. The subtotal is the sum of the line table a
 * customer can add up themselves, and everything after it comes from
 * `invoiceTotals` — the same arithmetic that produced the figures when the
 * invoice was raised. A second calculation would be a second answer waiting to
 * disagree with the first, and the disagreement would be on a document somebody
 * is being asked to pay.
 *
 * The credit and the tax carry across unchanged: neither is a property of the
 * lines, and re-deriving the tax would need a rate this does not have.
 */
export function recomputeInvoice(
  lines: InvoiceLine[],
  carried: { diagnosticCreditCents: number; taxCents: number },
): InvoiceTotals {
  return invoiceTotals({
    subtotalCents: linesSubtotalCents(lines),
    diagnosticPaidCents: carried.diagnosticCreditCents,
    taxCents: carried.taxCents,
  });
}

/** "$1,280.00" from cents, for a sentence somebody reads before tapping. */
export function money(cents: number): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    (Number.isFinite(cents) ? cents : 0) / 100,
  );
}
