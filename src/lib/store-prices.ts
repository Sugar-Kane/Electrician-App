import "server-only";

import { itemPriceKey, type MaterialItem } from "@/lib/material-list";
import { OpenAiRefusal, searchOpenAiWeb } from "@/lib/openai";
import { ReplyCutOff } from "@/lib/reply-cut-off";
import { readStorePrices, type ItemPrices, type PriceRejection, type RequestedItem } from "@/lib/store-price-rules";

/**
 * Looking up what a materials list costs at Home Depot and Lowe's, on the
 * business's own ChatGPT key: the model searches only those two stores' sites
 * and says what one of each item costs, and the rules in store-price-rules
 * decide which of those answers to believe.
 *
 * A few items to a search, a few searches at once, so a whole list comes back
 * in about the time one answer takes.
 */

/** The most items looked up in one go. */
export const MAX_PRICED_ITEMS = 40;
const PER_SEARCH = 5;
const AT_ONCE = 4;

const INSTRUCTIONS = [
  "You look up what electrical materials cost today at Home Depot (homedepot.com) and Lowe's (lowes.com), for a licensed electrician buying them for a job.",
  "For each item, search both stores for the product that matches it: the same size, rating and type, and the same color or pack where that matters.",
  'Give the price for ONE of what the item is counted in (its "per"): per foot for wire or conduit counted in feet, per stick, per box, per roll, otherwise per each.',
  'When a store only sells it in a bigger pack (a 500-ft spool, a 10-pack), divide the pack price down to one, and name the pack in "product", e.g. "Southwire 500-ft #10 THHN Black spool ($389.00)".',
  "Only give a price you saw on that store's own product page in this search, with that page's URL. If you can't find a matching product at a store, use null for that store. Never guess a price or a link.",
  "Answer with JSON only, no other words, in exactly this shape:",
  '{"items":[{"id":"<id>","homeDepot":{"price":5.98,"per":"ft","product":"<product name>","url":"https://www.homedepot.com/p/..."},"lowes":{"price":6.48,"per":"ft","product":"<product name>","url":"https://www.lowes.com/pd/..."}}]}',
  'Use null in place of {"price":...} for a store that does not have it.',
].join("\n");

type Asked = RequestedItem & { qty: string; name: string };

function promptFor(items: Asked[], where: string): string {
  return [
    where ? `The job is near ${where}.` : "",
    "Items (id | how many | what | per):",
    ...items.map((item) => `${item.id} | ${item.qty || "1"} | ${item.name} | per ${item.unit}`),
  ]
    .filter(Boolean)
    .join("\n");
}

/** The JSON in an answer, with or without a code fence around it. */
function readJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    return null;
  }
}

export type StorePriceRun = {
  /** What was found for each item looked up, by item id. */
  prices: Record<string, ItemPrices>;
  /** Why some or all items could not be looked up, in words for the person. */
  error: string | null;
  /** The error was the key's: refused, out of credit, or no web search. */
  keyRefused: boolean;
};

export async function lookUpStorePrices(input: {
  key: string;
  model: string;
  items: Pick<MaterialItem, "id" | "qty" | "name">[];
  place: { city?: string; region?: string; postalCode?: string };
  signal?: AbortSignal;
}): Promise<StorePriceRun> {
  const asked: Asked[] = input.items.slice(0, MAX_PRICED_ITEMS).map((item) => ({
    id: item.id,
    qty: item.qty,
    name: item.name,
    ...itemPriceKey(item),
  }));
  const where = [input.place.city, [input.place.region, input.place.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  const batches: Asked[][] = [];
  for (let at = 0; at < asked.length; at += PER_SEARCH) batches.push(asked.slice(at, at + PER_SEARCH));

  const prices: Record<string, ItemPrices> = {};
  const rejected: Record<PriceRejection, number> = { badUrl: 0, notInSearch: 0, wrongUnit: 0, badPrice: 0 };
  let error: string | null = null;
  let keyRefused = false;
  let searches = 0;
  let sources = 0;

  const run = async (batch: Asked[]) => {
    try {
      const answer = await searchOpenAiWeb({
        key: input.key,
        model: input.model,
        instructions: INSTRUCTIONS,
        prompt: promptFor(batch, where),
        allowedDomains: ["homedepot.com", "lowes.com"],
        place: { city: input.place.city, region: input.place.region },
        maxTokens: 12_000,
        signal: input.signal ? AbortSignal.any([input.signal, AbortSignal.timeout(100_000)]) : AbortSignal.timeout(100_000),
      });
      if (answer.searched) searches += 1;
      sources += answer.sources.length;
      const read = readStorePrices(readJson(answer.text), batch, answer, new Date().toISOString());
      Object.assign(prices, read.prices);
      for (const reason of Object.keys(rejected) as PriceRejection[]) rejected[reason] += read.rejected[reason];
      if (!answer.searched) error ??= "ChatGPT answered without searching the stores, so those prices were not used. Try again.";
    } catch (caught) {
      if (input.signal?.aborted) return;
      if (caught instanceof OpenAiRefusal) {
        keyRefused = true;
        error = caught.message;
      } else if (caught instanceof ReplyCutOff) {
        error ??= "Some prices took too long to write out. Try again for the rest.";
      } else {
        error ??= "Some store prices could not be looked up just now. Try again for the rest.";
        console.error("store price search failed", { error: String(caught) });
      }
    }
  };

  // A few searches at a time: each takes a while, and a key on a low OpenAI
  // tier is limited in how many it may run at once.
  const queue = [...batches];
  await Promise.all(
    Array.from({ length: Math.min(AT_ONCE, queue.length) }, async () => {
      for (let batch = queue.shift(); batch; batch = queue.shift()) await run(batch);
    }),
  );

  // Counts only: no keys, no links, nothing about the customer.
  const found = Object.values(prices).filter((each) => each.homeDepot || each.lowes).length;
  console.info("store prices", { asked: asked.length, found, searches, sources, rejected, failed: Boolean(error) });
  return { prices, error, keyRefused };
}
