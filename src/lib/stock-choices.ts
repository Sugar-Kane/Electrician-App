/**
 * Picking a part off the shelf for a job: finding it, describing it, and
 * saying when the shelf is short.
 *
 * Searched exactly the way the Stock page searches — name, part number or
 * where it lives — so a part that can be found there can be found from a job.
 *
 * Import-free apart from the shared name rules, so it can be tested without a
 * database or a browser.
 */
import { normalizeName } from "./inventory-match.ts";

export type StockChoice = {
  id: string;
  name: string;
  /** The SKU or catalogue number, as the business wrote it. */
  partNumber: string;
  unit: string;
  /** What one cost the business. Never a customer price. */
  unitCostCents: number;
  quantityOnHand: number;
  /** Held for open jobs: still on the shelf, but spoken for. */
  reserved?: number;
  location: string;
};

/** On hand less what open jobs are holding. */
function free(item: StockChoice): number {
  return Math.round((item.quantityOnHand - Math.max(0, item.reserved ?? 0)) * 1000) / 1000;
}

/** What is on the shelf that matches what was typed. Everything when nothing was. */
export function findStockChoices<T extends StockChoice>(stock: readonly T[], query: string): T[] {
  const needle = normalizeName(query);
  if (!needle) return [...stock];
  return stock.filter(
    (item) =>
      normalizeName(item.name).includes(needle) ||
      normalizeName(item.partNumber).includes(needle) ||
      normalizeName(item.location).includes(needle),
  );
}

/** "12.5" rather than "12.500", and "6" rather than "6.00". */
function count(quantity: number): string {
  return String(Math.round(quantity * 1000) / 1000);
}

/** The line under a part's name: what it is called in the catalogue, how many, where. */
export function stockChoiceDetail(item: StockChoice): string {
  const onHand = item.quantityOnHand > 0 ? `${count(item.quantityOnHand)} on hand` : "None on hand";
  const held = (item.reserved ?? 0) > 0 ? `${onHand}, ${count(item.reserved ?? 0)} reserved` : onHand;
  return [item.partNumber, held, item.location].filter((part) => part.trim()).join(" · ");
}

/**
 * What adding a part did: it is held for this job, not taken.
 *
 * Read off the redrawn item, so `reserved` already includes the line just
 * added. Free below zero is said as the number it is: more is promised than
 * the shelf holds, and that is worth knowing before the van leaves.
 */
export function stockReservedNote(item: StockChoice): string {
  const left = free(item);
  if (left >= 0) return `Reserved for this job. ${count(left)} of ${count(item.quantityOnHand)} still free.`;
  return `Reserved for this job, but that is ${count(-left)} more than you have free. Recount it or buy more.`;
}

/**
 * Said when a line asks for more than the shelf has free, or "" when it does not.
 *
 * A warning, not a refusal: the part may well be on the van and the count
 * wrong, and the job's bill should not wait for a stock-take. Free goes below
 * zero, which is how the Stock page finds out it was wrong.
 */
export function stockShortfall(item: StockChoice, quantity: number | null): string {
  const available = free(item);
  if (quantity === null || quantity <= available) return "";
  const reserved = item.reserved ?? 0;
  if (available <= 0) {
    return reserved > 0
      ? `None free: all ${count(item.quantityOnHand)} on hand are reserved for other jobs. Reserving it promises more than you have.`
      : "None on hand. Reserving it promises more than you have.";
  }
  return reserved > 0
    ? `Only ${count(available)} free (${count(item.quantityOnHand)} on hand, ${count(reserved)} reserved). Reserving ${count(quantity)} promises more than you have.`
    : `Only ${count(available)} on hand. Reserving ${count(quantity)} promises more than you have.`;
}
