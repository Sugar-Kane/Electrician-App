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
  unitPriceCents: number;
  quantityOnHand: number;
  location: string;
};

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
  return [item.partNumber, onHand, item.location].filter((part) => part.trim()).join(" · ");
}

/**
 * What the shelf holds once a part is added, so taking it is seen to happen.
 *
 * Below zero is said as the number it is. The part was in somebody's hand, so
 * it is the count that is wrong, and the way to fix that is to count.
 */
export function stockLeft(item: StockChoice): string {
  if (item.quantityOnHand > 0) return `${count(item.quantityOnHand)} left in inventory.`;
  if (item.quantityOnHand === 0) return "None left in inventory.";
  return `Inventory now shows ${count(item.quantityOnHand)}. Recount it when you can.`;
}

/**
 * Said when a line takes more than the shelf has, or "" when it does not.
 *
 * A warning, not a refusal: the part may well be on the van and the count
 * wrong, and the job's bill should not wait for a stock-take. The count goes
 * below zero, which is how the Stock page finds out it was wrong.
 */
export function stockShortfall(item: StockChoice, quantity: number | null): string {
  if (quantity === null || quantity <= item.quantityOnHand) return "";
  return item.quantityOnHand > 0
    ? `Only ${count(item.quantityOnHand)} on hand. Adding ${count(quantity)} takes the count below zero.`
    : "None on hand. Adding it takes the count below zero.";
}
