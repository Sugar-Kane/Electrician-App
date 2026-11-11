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
  /** How many the list needs, as written: "40 ft", "4", "1 box". */
  qty: string;
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

export type StoreCart = {
  store: StoreName;
  label: string;
  lines: CartLine[];
  /** Items on the list with no product matched at this store. */
  unmatched: string[];
};

function listed(qty: string, name: string): string {
  return qty ? `${qty} × ${name}` : name;
}

export function storeCart(list: MaterialList, store: StoreName): StoreCart {
  const lines: CartLine[] = [];
  const unmatched: string[] = [];
  for (const item of estimateItems(list)) {
    const price = item.prices?.[store] ?? null;
    const url = price ? storeProductUrl(store, price.url) : null;
    if (!price || !url) {
      unmatched.push(listed(item.qty, item.name));
      continue;
    }
    const last = url.split("/").pop() ?? "";
    lines.push({
      listed: listed(item.qty, item.name),
      qty: item.qty || "1",
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
    `For each line below, open its ${label} link. Do not search for a different product.`,
    "Choose store pickup at the electrician's usual store, unless they said otherwise.",
    `Set the quantity so it covers what the list needs. The list counts in its own units: when ${label} sells it in a pack or roll, add enough packs to cover it (40 ft of a 250 ft roll is 1 roll).`,
    "Add it to the cart. If it is out of stock, unavailable for pickup, or the page asks for an option the line does not say, skip it.",
    "Do not check out, place the order, apply payment or change anything in the account. Stop at the cart.",
    `Finish with what was added, what was skipped and why, and the cart total ${label} shows.`,
  ];
}
