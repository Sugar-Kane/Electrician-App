/**
 * Home Depot and Lowe's prices on a materials list.
 *
 * The AI searches the two stores' sites for each item and says what one costs.
 * What it says is only believed when it holds up: the price comes from that
 * store's own product page, the page was one the search actually returned, the
 * price is for one of what the list counts (a foot of wire, not the spool),
 * and the figure is a sane amount of money. Anything else is dropped rather
 * than put on an estimate.
 *
 * The store price is what the part costs the business. The customer pays the
 * higher of the two stores' prices (or the one picked) plus the business's
 * materials markup.
 *
 * Import-free, so the browser and the server apply the same rules.
 */

export type StoreName = "homeDepot" | "lowes";

export const STORE_NAMES: readonly StoreName[] = ["homeDepot", "lowes"];

export const STORES: Record<StoreName, { label: string; host: string; productPath: RegExp }> = {
  homeDepot: { label: "Home Depot", host: "homedepot.com", productPath: /^\/p\/./ },
  lowes: { label: "Lowe's", host: "lowes.com", productPath: /^\/pd\/./ },
};

export type StorePrice = {
  /** What one costs, in cents, counted the way the list counts it. */
  cents: number;
  /** The store's product page the price came from. */
  url: string;
  /** The product as the store names it, with its pack when divided down. */
  product: string;
  /** What one is: ft, stick, box, roll or each. */
  per: string;
};

export type ItemPrices = {
  /** The item these prices are for; a renamed or re-counted item is not it. */
  key: string;
  homeDepot: StorePrice | null;
  lowes: StorePrice | null;
  /** A store picked by hand; without one, the higher price is used. */
  use?: StoreName;
  checkedAt: string;
};

/** No single electrical part on a list costs more than this. */
const MAX_CENTS = 1_000_000;

/** Which item a price belongs to: what it is and what one of it is. */
export function priceKey(description: string, unit: string): string {
  return `${description.toLowerCase().replace(/\s+/g, " ").trim()}|${unit}`;
}

const PER_WORDS: Record<string, string> = {
  ft: "ft", foot: "ft", feet: "ft", "linear ft": "ft", "linear foot": "ft", "lin ft": "ft",
  each: "each", ea: "each", piece: "each", pc: "each", unit: "each", item: "each",
  box: "box", boxes: "box",
  roll: "roll", rolls: "roll",
  stick: "stick", sticks: "stick",
};

/** "per foot", "Feet", "ft." → "ft"; an unknown word stays itself and matches nothing. */
export function perWord(text: unknown): string {
  if (typeof text !== "string") return "";
  const word = text.toLowerCase().replace(/^per\s+/, "").replace(/\.$/, "").trim();
  return PER_WORDS[word] ?? word;
}

/**
 * A store's product page, written one way (https, www, no query), or null
 * when the link is anything else: another site, another store, a lookalike
 * host, a search page, or not a web link at all.
 */
export function storeProductUrl(store: StoreName, raw: unknown): string | null {
  if (typeof raw !== "string" || raw.length > 600) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return null;
  const { host, productPath } = STORES[store];
  const hostname = url.hostname.toLowerCase();
  if (hostname !== host && hostname !== `www.${host}`) return null;
  const path = url.pathname.replace(/\/+$/, "");
  if (!productPath.test(path)) return null;
  return `https://www.${host}${path}`;
}

/** Any link, written the way two links to the same page compare equal. */
function samePage(raw: string): string {
  try {
    const url = new URL(raw.trim());
    return `${url.hostname.toLowerCase().replace(/^www\./, "")}${url.pathname.replace(/\/+$/, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

/** "$5.98", "5.98" or 5.98 → 598 cents; null for anything that is not a sane price. */
function priceCents(raw: unknown): number | null {
  let value: number;
  if (typeof raw === "number") value = raw;
  else if (typeof raw === "string" && /^\s*\$?\s*\d+(?:\.\d+)?\s*$/.test(raw)) value = Number(raw.replace(/[$\s]/g, ""));
  else return null;
  if (!Number.isFinite(value)) return null;
  const cents = Math.round(value * 100);
  return cents >= 1 && cents <= MAX_CENTS ? cents : null;
}

export type PriceRejection = "badUrl" | "notInSearch" | "wrongUnit" | "badPrice";

type OneStore = { price: StorePrice } | { rejected: PriceRejection } | null;

function readOneStore(store: StoreName, raw: unknown, unit: string, sources: Set<string> | null, money: "dollars" | "cents"): OneStore {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const url = storeProductUrl(store, value.url);
  if (!url) return { rejected: "badUrl" };
  if (sources && !sources.has(samePage(url))) return { rejected: "notInSearch" };
  if (perWord(value.per) !== unit) return { rejected: "wrongUnit" };
  const cents =
    money === "cents"
      ? typeof value.cents === "number" && Number.isInteger(value.cents) && value.cents >= 1 && value.cents <= MAX_CENTS
        ? value.cents
        : null
      : priceCents(value.price);
  if (cents === null) return { rejected: "badPrice" };
  const product = typeof value.product === "string" ? value.product.replace(/\s+/g, " ").trim().slice(0, 160) : "";
  return { price: { cents, url, product, per: unit } };
}

/** What the search did: whether it searched at all, and the pages it returned when it says. */
export type SearchEvidence = { searched: boolean; sources: string[] };

export type RequestedItem = { id: string; key: string; unit: string };

/**
 * The AI's answer, believed only where it holds up. Each item asked about
 * comes back with what was found at each store (null for nothing usable);
 * when no search ran at all, nothing comes back, since nothing was looked up.
 */
export function readStorePrices(
  raw: unknown,
  requested: RequestedItem[],
  search: SearchEvidence,
  checkedAt: string,
): { prices: Record<string, ItemPrices>; rejected: Record<PriceRejection, number> } {
  const rejected: Record<PriceRejection, number> = { badUrl: 0, notInSearch: 0, wrongUnit: 0, badPrice: 0 };
  const prices: Record<string, ItemPrices> = {};
  if (!search.searched) return { prices, rejected };

  // The pages the search returned. When it returned none that could be read,
  // the link rules alone decide.
  const pages = new Set(search.sources.map(samePage).filter(Boolean));
  const sources = pages.size > 0 ? pages : null;

  const answered = new Map<string, Record<string, unknown>>();
  const list = raw && typeof raw === "object" ? (raw as { items?: unknown }).items : null;
  for (const entry of Array.isArray(list) ? list : []) {
    if (!entry || typeof entry !== "object") continue;
    const id = (entry as { id?: unknown }).id;
    if (typeof id === "string" && !answered.has(id)) answered.set(id, entry as Record<string, unknown>);
  }

  for (const item of requested) {
    const entry = answered.get(item.id);
    const found: ItemPrices = { key: item.key, homeDepot: null, lowes: null, checkedAt };
    for (const store of STORE_NAMES) {
      const result = readOneStore(store, entry?.[store], item.unit, sources, "dollars");
      if (result && "price" in result) found[store] = result.price;
      else if (result) rejected[result.rejected] += 1;
    }
    prices[item.id] = found;
  }
  return { prices, rejected };
}

/**
 * Prices saved on a list, read back from the browser: kept only while they
 * still belong to the item as it is now and every figure and link is one the
 * search rules would keep.
 */
export function readItemPrices(raw: unknown, item: { key: string; unit: string }): ItemPrices | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  if (value.key !== item.key) return null;
  const read = (store: StoreName) => {
    const result = readOneStore(store, value[store], item.unit, null, "cents");
    return result && "price" in result ? result.price : null;
  };
  const checkedAt = typeof value.checkedAt === "string" ? value.checkedAt.slice(0, 40) : "";
  const prices: ItemPrices = { key: item.key, homeDepot: read("homeDepot"), lowes: read("lowes"), checkedAt };
  if (value.use === "homeDepot" || value.use === "lowes") prices.use = value.use;
  return prices;
}

/** The store price the estimate uses: the one picked, else the higher, else whichever was found. */
export function chosenStorePrice(prices: ItemPrices | null | undefined): { store: StoreName; price: StorePrice } | null {
  if (!prices) return null;
  if (prices.use && prices[prices.use]) return { store: prices.use, price: prices[prices.use] as StorePrice };
  const { homeDepot, lowes } = prices;
  if (homeDepot && lowes) return lowes.cents > homeDepot.cents ? { store: "lowes", price: lowes } : { store: "homeDepot", price: homeDepot };
  if (homeDepot) return { store: "homeDepot", price: homeDepot };
  if (lowes) return { store: "lowes", price: lowes };
  return null;
}

/** Markup is a percent from 0 to 500, to a tenth. */
export function readMarkupPercent(raw: unknown): number | null {
  const value = typeof raw === "string" ? (raw.trim() ? Number(raw.trim().replace(/%$/, "")) : NaN) : typeof raw === "number" ? raw : NaN;
  if (!Number.isFinite(value) || value < 0 || value > 500) return null;
  return Math.round(value * 10) / 10;
}

/**
 * What the customer pays for one: the store price plus the markup, to the
 * nearest cent. Worked in tenths of a percent so the arithmetic is exact.
 */
export function customerPriceCents(costCents: number, markupPercent: number): number {
  const percent = Number.isFinite(markupPercent) ? Math.min(500, Math.max(0, markupPercent)) : 0;
  const tenths = Math.round(percent * 10);
  return Math.round((costCents * (1000 + tenths)) / 1000);
}

/** 718 → "7.18", for a price field. */
export function dollarsText(cents: number): string {
  return (cents / 100).toFixed(2);
}

/**
 * A pricing row filled from a store price: the customer's price and the cost,
 * as typed figures, in the unit the row is counted in. Blank when the store's
 * price is for something else (a price per foot is not a price per roll), so
 * a changed unit never carries a figure meant for another one.
 */
export function storePricing(
  prices: ItemPrices | null | undefined,
  store: StoreName | null,
  unit: string,
  markupPercent: number,
): { unitPrice: string; unitCost: string; store: StoreName | null } {
  const picked = prices && store ? prices[store] : null;
  const chosen = picked ? { store: store as StoreName, price: picked } : chosenStorePrice(prices);
  if (!chosen || chosen.price.per !== unit) return { unitPrice: "", unitCost: "", store: null };
  return {
    unitPrice: dollarsText(customerPriceCents(chosen.price.cents, markupPercent)),
    unitCost: dollarsText(chosen.price.cents),
    store: chosen.store,
  };
}
