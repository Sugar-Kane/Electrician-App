import test from "node:test";
import assert from "node:assert/strict";

import { carryPrices, itemPriceKey, normalizeMaterialList, parseMaterialList, type MaterialList } from "./material-list.ts";
import {
  chosenStorePrice,
  customerPriceCents,
  readStorePrices,
  storePricing,
  storeProductUrl,
  type ItemPrices,
} from "./store-price-rules.ts";

const HD = "https://www.homedepot.com/p/Southwire-10-THHN-Black/202316";
const LOWES = "https://www.lowes.com/pd/Southwire-10-THHN-Black/1000123";

const wire = { id: "w", ...itemPriceKey({ qty: "40 ft", name: "#10 THHN Black" }) };
const searched = { searched: true, sources: [HD, `${LOWES}?store=1234`] };

function answer(homeDepot: unknown, lowes: unknown = null) {
  return { items: [{ id: "w", homeDepot, lowes }] };
}

test("a price is kept only from that store's own product page", () => {
  assert.equal(storeProductUrl("homeDepot", HD), HD);
  assert.equal(storeProductUrl("homeDepot", "https://homedepot.com/p/x/1?x=1#y"), "https://www.homedepot.com/p/x/1");
  for (const url of [
    LOWES, // the other store
    "http://www.homedepot.com/p/x/1", // not https
    "javascript:alert(1)//www.homedepot.com/p/x",
    "https://www.homedepot.com.evil.example/p/x/1", // a lookalike host
    "https://evilhomedepot.com/p/x/1",
    "https://www.homedepot.com/s/thhn", // a search page, not a product
    "https://user:pass@www.homedepot.com/p/x/1",
  ]) {
    assert.equal(storeProductUrl("homeDepot", url), null, url);
  }
  assert.equal(storeProductUrl("lowes", HD), null);
});

test("a price the search never saw, or with no search at all, is not believed", () => {
  const madeUp = readStorePrices(answer({ price: 0.89, per: "ft", url: "https://www.homedepot.com/p/Invented/999" }), [wire], searched, "t");
  assert.equal(madeUp.prices.w.homeDepot, null);
  assert.equal(madeUp.rejected.notInSearch, 1);

  const seen = readStorePrices(answer({ price: 0.89, per: "foot", url: HD }, { price: "$0.92", per: "ft", url: LOWES }), [wire], searched, "t");
  assert.equal(seen.prices.w.homeDepot?.cents, 89);
  assert.equal(seen.prices.w.lowes?.cents, 92);

  const noSearch = readStorePrices(answer({ price: 0.89, per: "ft", url: HD }), [wire], { searched: false, sources: [] }, "t");
  assert.deepEqual(noSearch.prices, {});
  assert.equal(noSearch.evidence, false);

  // A search that names no pages it used is no proof of any price.
  for (const sources of [[], ["not a link"]]) {
    const unproven = readStorePrices(answer({ price: 0.89, per: "ft", url: HD }), [wire], { searched: true, sources }, "t");
    assert.deepEqual(unproven.prices, {}, JSON.stringify(sources));
    assert.equal(unproven.evidence, false);
  }
});

test("an item the answer left out is not recorded as looked up, so it can be tried again", () => {
  const other = { id: "o", ...itemPriceKey({ qty: "1", name: "Eaton BR220 breaker" }) };
  const result = readStorePrices(answer({ price: 0.89, per: "ft", url: HD }), [wire, other], searched, "t");
  assert.equal(result.prices.w.homeDepot?.cents, 89);
  assert.equal("o" in result.prices, false);
});

test("a price is for one of what the list counts: a spool price never lands on a per-foot item", () => {
  const spool = readStorePrices(answer({ price: 389, per: "each", url: HD }), [wire], searched, "t");
  assert.equal(spool.prices.w.homeDepot, null);
  assert.equal(spool.rejected.wrongUnit, 1);
});

test("only a sane amount of money is kept", () => {
  for (const price of [0, -5, "abc", Number.NaN, 10_000.01, null]) {
    const result = readStorePrices(answer({ price, per: "ft", url: HD }), [wire], searched, "t");
    assert.equal(result.prices.w.homeDepot, null, String(price));
  }
});

test("the estimate uses the higher store price unless a store was picked", () => {
  const prices: ItemPrices = {
    key: "k",
    checkedAt: "t",
    homeDepot: { cents: 598, url: HD, product: "", per: "ft" },
    lowes: { cents: 648, url: LOWES, product: "", per: "ft" },
  };
  assert.equal(chosenStorePrice(prices)?.price.cents, 648);
  assert.equal(chosenStorePrice({ ...prices, use: "homeDepot" })?.price.cents, 598);
  assert.equal(chosenStorePrice({ ...prices, lowes: null })?.store, "homeDepot");
  assert.equal(chosenStorePrice({ ...prices, lowes: null, use: "lowes" })?.store, "homeDepot");
  assert.equal(chosenStorePrice({ ...prices, homeDepot: null, lowes: null }), null);
});

test("the customer pays the store price plus the markup, to the nearest cent", () => {
  assert.equal(customerPriceCents(78, 20), 94);
  assert.equal(customerPriceCents(598, 20), 718);
  assert.equal(customerPriceCents(1005, 10), 1106);
  assert.equal(customerPriceCents(598, 0), 598);
  assert.equal(customerPriceCents(598, 12.5), 673);
  assert.equal(customerPriceCents(100, -20), 100);
});

test("a store price fills a row only in the unit it is for: a new unit never keeps a per-foot price", () => {
  const prices: ItemPrices = {
    key: "k",
    checkedAt: "t",
    homeDepot: { cents: 78, url: HD, product: "", per: "ft" },
    lowes: { cents: 92, url: LOWES, product: "", per: "ft" },
  };
  assert.deepEqual(storePricing(prices, null, "ft", 20), { unitPrice: "1.10", unitCost: "0.92", store: "lowes" });
  assert.deepEqual(storePricing(prices, "lowes", "roll", 20), { unitPrice: "", unitCost: "", store: null });
  assert.deepEqual(storePricing(prices, null, "each", 20), { unitPrice: "", unitCost: "", store: null });
  assert.deepEqual(storePricing(prices, "homeDepot", "ft", 20), { unitPrice: "0.94", unitCost: "0.78", store: "homeDepot" });
  assert.deepEqual(storePricing(undefined, null, "ft", 20), { unitPrice: "", unitCost: "", store: null });
});

test("prices stay with an item only while it is the same thing", () => {
  const prices: ItemPrices = {
    ...itemPriceKey({ qty: "40 ft", name: "#10 THHN Black" }),
    checkedAt: "t",
    homeDepot: { cents: 89, url: HD, product: "", per: "ft" },
    lowes: null,
  };
  delete (prices as { unit?: string }).unit;
  const listWith = (qty: string, name: string): MaterialList => ({
    intro: "",
    title: "",
    closing: "",
    sections: [{ id: "s", heading: "Conductors", blocks: [{ type: "items", items: [{ id: "w", qty, name, note: "", prices }] }] }],
  });
  const kept = (list: MaterialList | null) => {
    const block = list?.sections[0].blocks[0];
    return block?.type === "items" ? block.items[0].prices?.homeDepot?.cents : undefined;
  };

  assert.equal(kept(normalizeMaterialList(listWith("60 ft", "#10 THHN Black"))), 89); // a new count
  assert.equal(kept(normalizeMaterialList(listWith("40 ft", "#12 THHN Black"))), undefined); // a new name
  assert.equal(kept(normalizeMaterialList(listWith("2 roll", "#10 THHN Black"))), undefined); // a new unit

  // A forged figure from the browser is dropped like any other bad price.
  const forged = listWith("40 ft", "#10 THHN Black");
  const block = forged.sections[0].blocks[0];
  if (block.type === "items") block.items[0].prices = { ...prices, homeDepot: { cents: 89, url: "https://example.com/p/x", product: "", per: "ft" } };
  assert.equal(kept(normalizeMaterialList(forged)), undefined);

  // A revision keeps the prices of what did not change.
  const revised = parseMaterialList("## Conductors\n- 60 ft × #10 THHN Black\n- 40 ft × #10 THHN White", "r");
  const carried = carryPrices(listWith("40 ft", "#10 THHN Black"), revised);
  const items = carried.sections[0].blocks[0];
  assert.ok(items.type === "items");
  assert.equal(items.items[0].prices?.homeDepot?.cents, 89);
  assert.equal(items.items[1].prices, undefined);
});
