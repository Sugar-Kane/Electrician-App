import { findStock, normalizeName, type StockItem } from "./inventory-match.ts";

/**
 * A supplier receipt, turned into stock.
 *
 * The receipt is the moment stock actually arrives, and until now it was the
 * one moment the app knew nothing about: somebody drove back from the supply
 * house with a bag of breakers and a paper receipt, and the stock list carried
 * on saying what it said yesterday. The receipt then went in the glovebox and
 * came out in April, when the year's material spend had to be reconstructed
 * from it.
 *
 * So: photograph it, and the lines on it become `received` movements at the
 * price actually paid. That is the count fixed and the purchase recorded in the
 * same tap.
 *
 * Nothing here trusts the reading. A model looking at a crumpled thermal
 * receipt will misread a quantity sooner or later, and a misread quantity that
 * writes itself into stock is worse than no scanner at all — the count would be
 * wrong and nobody would know why. Every figure lands in an editable row, the
 * arithmetic is checked against the printed total, and the disagreement is said
 * out loud rather than smoothed over.
 *
 * Import-free apart from the matcher, so all of it can be tested without a
 * database, a bucket or a model.
 */

export type ReceiptLine = {
  name: string;
  quantity: number;
  unit: string;
  unitCostCents: number;
  partNumber: string;
};

export type ReceiptReading = {
  supplier: string;
  /** YYYY-MM-DD, or "" when the receipt does not show one legibly. */
  purchasedOn: string;
  lines: ReceiptLine[];
  /** What the receipt says it came to, in cents. 0 when unreadable. */
  printedTotalCents: number;
};

/** Longest a name, unit or part number is allowed to be. */
const MAX_NAME = 200;
const MAX_UNIT = 24;
const MAX_PART_NUMBER = 64;

function str(value: unknown, cap: number): string {
  return typeof value === "string" ? value.trim().slice(0, cap) : "";
}

/**
 * One line off a receipt, as a row that can be edited.
 *
 * A line with no name is not a line — it is the model finding something on the
 * page that was never a part, and it is dropped. Everything else has a fallback
 * that reads as "somebody should look at this": an unreadable quantity becomes
 * 1, because a receipt line is at least one of something, and an unreadable
 * price becomes 0, which shows in the review as an empty cost box rather than
 * as a number nobody chose.
 */
export function readReceiptLine(raw: unknown): ReceiptLine | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;

  const name = str(row.name, MAX_NAME);
  if (!name) return null;

  const quantity = Number(row.quantity);
  const cost = Number(row.unit_cost_cents ?? row.unitCostCents);

  return {
    name,
    quantity: Number.isFinite(quantity) && quantity > 0 ? Math.round(quantity * 100) / 100 : 1,
    unit: str(row.unit, MAX_UNIT) || "each",
    // Never negative. A credit line on a receipt is a return, which is a
    // different movement from a purchase and not something to guess at here.
    unitCostCents: Number.isFinite(cost) && cost > 0 ? Math.round(cost) : 0,
    partNumber: str(row.part_number ?? row.partNumber, MAX_PART_NUMBER),
  };
}

/** What one line came to. */
export function lineTotalCents(line: { quantity: number; unitCostCents: number }): number {
  return Math.round(line.quantity * line.unitCostCents);
}

/** What the lines come to, before tax. */
export function linesTotalCents(lines: { quantity: number; unitCostCents: number }[]): number {
  return lines.reduce((sum, line) => sum + lineTotalCents(line), 0);
}

/**
 * How far above the parts a printed total may sit before it is worth a warning.
 *
 * California is 7.25% statewide and district taxes take the worst of it past
 * 10.75%, so anything inside 12% is ordinary sales tax and saying so would be
 * noise. Past that there is usually a line on the paper that was not read —
 * delivery, a core charge, a second page.
 */
export const TAX_HEADROOM = 0.12;

/** A cent or two either way is the rounding, not a discrepancy. */
const ROUNDING_SLACK_CENTS = 2;

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export type ReceiptCheck = {
  /** True when the person should look before saving. */
  worthChecking: boolean;
  message: string;
};

/**
 * Whether the lines and the printed total tell the same story.
 *
 * The two are not supposed to match — the total has tax on it — so this is not
 * an equality check. It is looking for the two shapes of misreading that
 * actually happen: a quantity read as 12 instead of 2, which pushes the parts
 * above the total, and a whole line missed, which leaves the total stranded far
 * above the parts.
 */
export function checkReceiptTotals(
  lineTotal: number,
  printedTotal: number,
): ReceiptCheck {
  // Nothing printed to compare against, or nothing priced yet. Either way there
  // is no arithmetic to be suspicious of.
  if (printedTotal <= 0 || lineTotal <= 0) return { worthChecking: false, message: "" };

  if (lineTotal > printedTotal + ROUNDING_SLACK_CENTS) {
    return {
      worthChecking: true,
      message: `These lines come to ${dollars(lineTotal)}, which is more than the ${dollars(printedTotal)} on the receipt. Check the quantities before saving.`,
    };
  }

  if (printedTotal > Math.round(lineTotal * (1 + TAX_HEADROOM))) {
    return {
      worthChecking: true,
      message: `These lines come to ${dollars(lineTotal)} and the receipt says ${dollars(printedTotal)}. Something on it may not have been read — check before saving.`,
    };
  }

  return {
    worthChecking: false,
    message: `${dollars(lineTotal)} of parts. The receipt says ${dollars(printedTotal)} with tax.`,
  };
}

export type ReceiptPlanLine = ReceiptLine & {
  /** The stock row this will move, or "" when the part is new. */
  matchId: string;
  /** What that row is called, which is not always what the receipt calls it. */
  matchName: string;
  /** What it reads now, so the review can show before and after. */
  onHand: number;
  /**
   * The receipt's own unit, kept when it disagrees with the stock row's.
   *
   * Two boxes cannot be added to a count of eaches, so the quantity saved is in
   * the unit the item is counted in — and the receipt's word for it is carried
   * here so the review can say which is which instead of quietly converting
   * something it has no conversion for.
   */
  receiptUnit: string;
};

/**
 * The stock row a receipt line belongs to.
 *
 * A printed part number is an identity and settles it. Failing that, the same
 * name matching the materials list uses — deliberately the same, because a
 * receipt line that matches here and not there would put stock on the shelf
 * that the job list then says has to be bought.
 */
export function matchReceiptLine(
  line: ReceiptLine,
  stock: StockItem[],
): StockItem | undefined {
  const printed = normalizeName(line.partNumber);
  if (printed) {
    const exact = stock.find((item) => normalizeName(item.partNumber ?? "") === printed);
    if (exact) return exact;
  }

  return findStock({ name: line.name, quantity: line.quantity, unit: line.unit }, stock);
}

/**
 * Every line, said against what the business already has.
 *
 * A matched line adds to a row that exists; an unmatched one creates a row. The
 * distinction is the whole reason the review screen exists — "add 4 to the 12
 * you have" and "put a part you have never stocked on the list" deserve
 * different amounts of attention, and the person is the one who can tell.
 */
export function planReceipt(lines: ReceiptLine[], stock: StockItem[]): ReceiptPlanLine[] {
  return lines.map((line) => {
    const match = matchReceiptLine(line, stock);
    if (!match) {
      return { ...line, matchId: "", matchName: "", onHand: 0, receiptUnit: "" };
    }

    const stockUnit = (match.unit || "each").trim();
    const differs = normalizeName(stockUnit) !== normalizeName(line.unit || "each");

    return {
      ...line,
      // Counted in the unit the shelf is counted in. The receipt's word for it
      // survives beside it rather than being converted.
      unit: stockUnit,
      receiptUnit: differs ? line.unit : "",
      matchId: match.id,
      matchName: match.name,
      onHand: Number.isFinite(match.quantity) ? match.quantity : 0,
    };
  });
}

/** One line for the top of the review: what this receipt is about to do. */
export function describeReceiptPlan(lines: ReceiptPlanLine[]): string {
  if (lines.length === 0) return "Nothing on this receipt could be read as a part.";

  const fresh = lines.filter((line) => !line.matchId).length;
  const known = lines.length - fresh;

  if (fresh === 0) return `${known} ${known === 1 ? "part" : "parts"} you already stock.`;
  if (known === 0) return `${fresh} ${fresh === 1 ? "part" : "parts"} new to your stock list.`;
  return `${known} you already stock, ${fresh} new to the list.`;
}
