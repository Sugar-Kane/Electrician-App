/**
 * What a job has billed, what it has not, and what the customer agreed to.
 *
 * Lines are written whenever they are remembered — at booking, on site, or
 * after the invoice has gone out. Each line records the invoice that billed it,
 * so a line added late is simply one with no invoice yet, and the question is
 * only where it goes:
 *
 * - no invoice yet: on the first one;
 * - the newest invoice is a draft nobody has been sent or paid: onto that
 *   draft, because the customer has never seen it;
 * - the newest invoice has gone out or been paid: onto a new invoice of its
 *   own, for the difference. A sent or paid invoice's figures never move.
 *
 * Contracts work the same way with signatures instead of payments. A contract
 * covers the lines that existed when it was drawn up; a line written after the
 * newest signed one is a change the customer has not agreed to, and goes on a
 * change order for them to sign.
 *
 * Import-free apart from the shared rules it reuses, so all of it can be tested
 * without a database.
 */
import { fillTemplate, type ContractFacts, type FilledContract } from "./contract-template.ts";
import { canEditInvoice } from "./document-edit.ts";
import { formatCents, formatQuantity, lineTotalCents } from "./job-lines.ts";

export type BillableLine = {
  id: string;
  description: string;
  quantity: number;
  unit: string;
  unitPriceCents: number;
  /** The invoice that billed it, or null while nothing has. */
  invoiceId: string | null;
  /** When it was written, as an ISO timestamp. */
  createdAt: string;
};

export type InvoiceStanding = {
  id: string;
  /** As the business refers to it, without the prefix: "12" for INV-12. */
  number: string;
  status: string;
  totalCents: number;
  lastSentAt: string | null;
  paidAt: string | null;
  createdAt: string;
};

export type ContractStanding = {
  id: string;
  kind: "agreement" | "change_order";
  status: string;
  createdAt: string;
  signedAt: string | null;
};

function time(iso: string | null | undefined): number {
  const at = Date.parse(iso ?? "");
  return Number.isFinite(at) ? at : 0;
}

function newestFirst<T extends { createdAt: string }>(rows: readonly T[]): T[] {
  return [...rows].sort((a, b) => time(b.createdAt) - time(a.createdAt));
}

function centsOf(lines: readonly Pick<BillableLine, "quantity" | "unitPriceCents">[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

/** A voided invoice bills nothing, so its lines are unbilled again. */
export function invoiceIsLive(invoice: Pick<InvoiceStanding, "status">): boolean {
  return invoice.status !== "void";
}

/**
 * A draft the customer has never seen and nobody has paid — the only kind of
 * invoice whose figures may still move. The same rule the assistant's edits
 * answer to, so the two can never disagree about which invoices are settled.
 */
export function invoiceIsOpenDraft(
  invoice: Pick<InvoiceStanding, "status" | "lastSentAt" | "paidAt">,
): boolean {
  return canEditInvoice({
    status: invoice.status,
    lastSentAt: invoice.lastSentAt,
    paidAt: invoice.paidAt,
  }).ok;
}

/** Lines no live invoice has billed. */
export function unbilledLines<T extends Pick<BillableLine, "invoiceId">>(
  lines: readonly T[],
  invoices: readonly Pick<InvoiceStanding, "id" | "status">[],
): T[] {
  const live = new Set(invoices.filter(invoiceIsLive).map((invoice) => invoice.id));
  return lines.filter((line) => !line.invoiceId || !live.has(line.invoiceId));
}

export type BillingStep =
  /** Nothing priced is waiting to be billed. */
  | { kind: "nothing" }
  /** No invoice yet: the first one bills everything. */
  | { kind: "first"; cents: number; count: number }
  /** The newest invoice is a draft nobody has seen: the new lines go on it. */
  | { kind: "add_to_draft"; cents: number; count: number; invoice: InvoiceStanding }
  /** The newest invoice has gone out or been paid: the new lines are billed on their own. */
  | { kind: "bill_difference"; cents: number; count: number; after: InvoiceStanding };

/** Where the job's unbilled lines go next, and what they come to. */
export function nextBillingStep(
  lines: readonly Pick<BillableLine, "invoiceId" | "quantity" | "unitPriceCents">[],
  invoices: readonly InvoiceStanding[],
): BillingStep {
  const waiting = unbilledLines(lines, invoices);
  const cents = centsOf(waiting);
  // A line worth nothing is not a reason to raise an invoice. It is still
  // claimed by whichever invoice comes next, so it does not linger.
  if (cents <= 0) return { kind: "nothing" };

  const newest = newestFirst(invoices.filter(invoiceIsLive))[0];
  const count = waiting.length;
  if (!newest) return { kind: "first", cents, count };
  if (invoiceIsOpenDraft(newest)) return { kind: "add_to_draft", cents, count, invoice: newest };
  return { kind: "bill_difference", cents, count, after: newest };
}

/**
 * Why a line can no longer be taken off the job, or "" when it can.
 *
 * A line on a sent or paid invoice is part of what the customer was charged.
 * Removing it from the job would leave that invoice billing a line that no
 * longer exists, and the next copy of its PDF printing a different bill from
 * the one in the customer's hands. A line on an unseen draft can go: the draft
 * is updated with it.
 */
export function lineLockedBecause(
  line: Pick<BillableLine, "invoiceId">,
  invoices: readonly InvoiceStanding[],
): string {
  if (!line.invoiceId) return "";
  const invoice = invoices.find((candidate) => candidate.id === line.invoiceId);
  if (!invoice || !invoiceIsLive(invoice) || invoiceIsOpenDraft(invoice)) return "";

  const paid = Boolean(invoice.paidAt) || invoice.status === "paid";
  return paid
    ? `Billed on INV-${invoice.number}, which has been paid, so it stays on the job.`
    : `Billed on INV-${invoice.number}, which has gone to the customer, so it stays on the job.`;
}

export type AgreementChanges<T> = {
  /** The newest signed contract or change order: what the customer last agreed to. */
  signed: ContractStanding | null;
  /** Lines written after it was drawn up, which it does not cover. */
  added: T[];
  addedCents: number;
  /** An unsigned contract or change order, newer than every added line, waiting to be signed. */
  waiting: ContractStanding | null;
  /**
   * The newest contract is unsigned and was drawn up before some of the lines,
   * so it does not include them. Signing it would agree to less than the job.
   */
  behind: boolean;
};

/**
 * What has changed since the customer last signed.
 *
 * By when each line was written rather than by comparing totals: a contract's
 * price can be typed in by hand, and "this breaker was added on Tuesday, after
 * you signed on Monday" is a fact, where a difference between two figures is
 * an argument.
 */
export function agreementChanges<T extends Pick<BillableLine, "createdAt" | "quantity" | "unitPriceCents">>(
  lines: readonly T[],
  contracts: readonly ContractStanding[],
): AgreementChanges<T> {
  const live = newestFirst(contracts.filter((contract) => contract.status !== "void"));
  const newest = live[0] ?? null;
  const signed = live.find((contract) => Boolean(contract.signedAt)) ?? null;

  const writtenAfter = (contract: ContractStanding) =>
    lines.filter((line) => time(line.createdAt) > time(contract.createdAt));

  const pending = newest && !newest.signedAt ? newest : null;

  if (!signed) {
    return {
      signed: null,
      added: [],
      addedCents: 0,
      waiting: null,
      behind: Boolean(pending) && writtenAfter(pending!).length > 0,
    };
  }

  const added = writtenAfter(signed);
  const covers = pending && time(pending.createdAt) > time(signed.createdAt) ? pending : null;
  const behind = Boolean(covers) && writtenAfter(covers!).length > 0;

  return {
    signed,
    added,
    addedCents: centsOf(added),
    waiting: added.length > 0 && covers && !behind ? covers : null,
    behind,
  };
}

/** "{{" in a line somebody typed must not read as a blank to fill in later. */
function plain(text: string): string {
  return text.replace(/\{\{|\}\}/g, (pair) => pair[0]!);
}

/** One added line as the change order lists it. */
export function changeOrderLine(line: Pick<BillableLine, "description" | "quantity" | "unit" | "unitPriceCents">): string {
  const quantity = `${formatQuantity(line.quantity)} ${line.unit || "each"}`;
  return `${plain(line.description.trim())} — ${quantity} at ${formatCents(line.unitPriceCents)}: ${formatCents(lineTotalCents(line))}`;
}

/**
 * The words of a change order.
 *
 * The parties and the job come from the same facts a contract is filled from,
 * so a missing name is a blank to fill in exactly as it is on a contract, and
 * the page refuses to let anybody sign around it. The added lines are written
 * in after filling, so nothing typed on a line can be mistaken for a blank.
 */
export function changeOrderBody(input: {
  facts: Partial<ContractFacts>;
  /** When the customer last signed, as it should read: "Oct 2, 2026". */
  signedOn: string;
  lines: readonly Pick<BillableLine, "description" | "quantity" | "unit" | "unitPriceCents">[];
}): FilledContract {
  const head = fillTemplate(
    `CHANGE ORDER

This change order is made on {{today}} between {{business_name}} ("the Contractor") and {{customer_name}} ("the Customer"). It adds to the work agreed for job {{job_number}} at {{service_address}}${input.signedOn ? `, signed on ${plain(input.signedOn)}` : ""}.`,
    input.facts,
  );

  const total = centsOf(input.lines);
  const body = [
    head.body,
    ["WORK AND PARTS ADDED", ...input.lines.map(changeOrderLine)].join("\n"),
    `PRICE\nThese additions come to ${formatCents(total)}, on top of the price already agreed.`,
    "Everything else that was agreed stays the same. By signing, the Customer approves the additions above and agrees to pay for them.",
  ].join("\n\n");

  return { body, unfilled: head.unfilled };
}
