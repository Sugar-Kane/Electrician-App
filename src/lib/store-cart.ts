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
    `In store only. Set the store to the electrician's usual ${label} (ask if you cannot tell which) and choose store pickup for every item. Never choose delivery, ship to home or ship to store.`,
    `Choose in this order of priority: available in store first, then name brand, then the store's own or a generic brand, then on the shelf today, and only then an alternate product. Prefer what is on the shelf at that store today: an item shown in stock there, with an aisle and bay where ${label} shows one. An item that is online only, special order, or only available to ship to the store counts as unavailable.`,
    `Set the quantity so it covers what the list needs. The list counts in its own units: when ${label} sells it in a pack or roll, add enough packs to cover it (40 ft of a 250 ft roll is 1 roll).`,
    `Where a line says it has no quantity, recommend one from the job and the rest of the list (a box count from the number of devices, a wire length from the runs, one spare for small parts), add that many, and say how you got the number.`,
    `For each item not matched at ${label}, search ${host} and recommend the closest product that meets what the list says: the same size, rating, amperage, gauge, length and type, rated for the job (UL listed, indoor or outdoor, wet location where it says so). Choose among items in stock on the shelf at the electrician's store first; only if none meets the spec, say so rather than picking an online-only item. Among those, choose in this order: a name brand (Leviton, Eaton, Square D, Southwire, Carlon and the like, preferring one already in the cart), then the store's own or a generic brand. Every pick must still meet the spec and be UL listed. Add your recommendation to the cart, with the quantity worked out the same way. If nothing meets the spec, add nothing and say what you would look for instead.`,
    "If a matched product cannot be had in store (not in stock for pickup at that store), recommend the closest substitute that can, the same way (in store, name brand before generic, on the shelf), and add that instead. Substitutes come last: use one only when the matched product cannot be had in store. If a page asks for an option the line does not say, pick the one that fits the job and say which.",
    "Do not check out, place the order, apply payment or change anything in the account. Stop at the cart.",
    `Finish with three lists: added as matched; recommended by you (each with the product, quantity, price, aisle and bay where shown, and why it fits, so the electrician can check it before paying); and skipped, with why. Then the cart total ${label} shows and the store the cart is set to.`,
  ];
}
