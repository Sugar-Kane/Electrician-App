/**
 * A job's materials, as a Home Depot or Lowe's cart to fill.
 *
 * Neither store has a way for another app to put things in someone's cart, so
 * the cart is filled the way a person would: by ChatGPT's agent, in its own
 * browser, signed in to the electrician's store account. This is what it works
 * from — one line per product page, with the count the list asks for — and the
 * steps it follows. Nothing here buys anything; the agent stops at the cart and
 * the electrician checks out.
 *
 * Import-free apart from the list and price rules, so the page and the ChatGPT
 * tool read a list the same way.
 */

import { estimateItems, type MaterialList } from "./material-list.ts";
import { STORES, storeProductUrl, type StoreName } from "./store-price-rules.ts";

/** How a store is named in a link and to ChatGPT. */
export const CART_STORES: Record<string, StoreName> = { "home-depot": "homeDepot", lowes: "lowes" };

export function cartSlug(store: StoreName): string {
  return store === "homeDepot" ? "home-depot" : "lowes";
}

export function cartStore(slug: unknown): StoreName | null {
  return typeof slug === "string" && Object.hasOwn(CART_STORES, slug) ? CART_STORES[slug] : null;
}

export type CartLine = {
  /** What the list calls it, with its count: "40 ft × 12/2 NM-B". */
  listed: string;
  /** How many the list needs, as written: "40 ft", "4", "1 box". Empty when the list gives no count. */
  qty: string;
  /** The list gives no usable count, so the agent recommends one. */
  needsQty: boolean;
  /** The product as the store names it, pack included. */
  product: string;
  url: string;
  /** The store's item number, the last part of the product link. */
  sku: string;
  /** The price matched, per `per`, in cents. */
  cents: number;
  per: string;
  note: string;
};

/** An item on the list with no product matched at this store: the agent finds one. */
export type UnmatchedLine = { listed: string; qty: string; name: string; note: string; needsQty: boolean };

export type StoreCart = {
  store: StoreName;
  label: string;
  lines: CartLine[];
  unmatched: UnmatchedLine[];
};

function listed(qty: string, name: string): string {
  return qty ? `${qty} × ${name}` : name;
}

/** A count starts with a number: "40 ft", "4", "½ box". "As needed" is not one. */
function hasCount(qty: string): boolean {
  return /^[0-9½¼¾⅛]/.test(qty.trim());
}

export function storeCart(list: MaterialList, store: StoreName): StoreCart {
  const lines: CartLine[] = [];
  const unmatched: UnmatchedLine[] = [];
  for (const item of estimateItems(list)) {
    const price = item.prices?.[store] ?? null;
    const url = price ? storeProductUrl(store, price.url) : null;
    if (!price || !url) {
      unmatched.push({ listed: listed(item.qty, item.name), qty: item.qty, name: item.name, note: item.note, needsQty: !hasCount(item.qty) });
      continue;
    }
    const last = url.split("/").pop() ?? "";
    lines.push({
      listed: listed(item.qty, item.name),
      qty: item.qty,
      needsQty: !hasCount(item.qty),
      product: price.product || item.name,
      url,
      sku: /^\d{4,12}$/.test(last) ? last : "",
      cents: price.cents,
      per: price.per,
      note: item.note,
    });
  }
  return { store, label: STORES[store].label, lines, unmatched };
}

/** What the agent is told to do, at either store. */
export function cartAgentSteps(store: StoreName): string[] {
  const { label, host } = STORES[store];
  return [
    `Sign in to ${host} with the electrician's ${label} account if it is not signed in already. If a password or code is needed, hand the browser to the electrician; never type one in yourself.`,
    `For each matched product, open its ${label} link. Do not swap it for a different product.`,
    "Choose store pickup at the electrician's usual store, unless they said otherwise.",
    `Set the quantity so it covers what the list needs. The list counts in its own units: when ${label} sells it in a pack or roll, add enough packs to cover it (40 ft of a 250 ft roll is 1 roll).`,
    `Where a line says it has no quantity, recommend one from the job and the rest of the list (a box count from the number of devices, a wire length from the runs, one spare for small parts), add that many, and say how you got the number.`,
    `For each item not matched at ${label}, search ${host} and recommend the closest product that meets what the list says: the same size, rating, amperage, gauge, length and type, rated for the job (UL listed, indoor or outdoor, wet location where it says so). Prefer a brand already in the cart. Add your recommendation to the cart, with the quantity worked out the same way. If nothing meets the spec, add nothing and say what you would look for instead.`,
    "If a matched product is out of stock or unavailable for pickup, recommend the closest in-stock substitute the same way and add it. If a page asks for an option the line does not say, pick the one that fits the job and say which.",
    "Do not check out, place the order, apply payment or change anything in the account. Stop at the cart.",
    `Finish with three lists: added as matched; recommended by you (each with the product, quantity, price and why it fits, so the electrician can check it before paying); and skipped, with why. Then the cart total ${label} shows.`,
  ];
}
