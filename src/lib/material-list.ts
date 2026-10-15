/**
 * A job's materials list, in the shape electricians already get from ChatGPT:
 * a line saying what it is for, a title, sections of "4 × 10-ft sticks ¾" EMT"
 * bullets with short notes between them, a buy list, a "before installation
 * day" checklist, and a closing word.
 *
 * The model writes it as plain text in that format, so it can be shown as it
 * arrives and reads exactly as it would in ChatGPT. It is then read into
 * sections and items, so each item can be tapped and edited, and written back
 * out the same way to copy, or to hand to the model when asked for changes.
 *
 * Import-free, so the browser and the server read a list the same way.
 */

import { priceKey, readItemPrices, type ItemPrices } from "./store-price-rules.ts";

export type MaterialItem = {
  id: string;
  /** "4", "40 ft", "1 box". Empty when the line has no count. */
  qty: string;
  /** '10-ft sticks ¾" EMT' */
  name: string;
  /** What to check about it, shown in brackets after the name. */
  note: string;
  /** What one costs at Home Depot and Lowe's, when it has been looked up. */
  prices?: ItemPrices;
};

export type MaterialBlock = { type: "text"; text: string } | { type: "items"; items: MaterialItem[] };

export type MaterialSection = { id: string; heading: string; blocks: MaterialBlock[] };

export type MaterialList = {
  /** The opening line: what the list is for, or what changed. */
  intro: string;
  title: string;
  sections: MaterialSection[];
  /** The closing word, after the last section. */
  closing: string;
};

export type ChatTurn = { role: "user" | "assistant"; text: string; at: string };

const LIMITS = { sections: 30, blocks: 40, items: 80, text: 1200, name: 200, qty: 24, note: 300, title: 160 } as const;

export const EMPTY_LIST: MaterialList = { intro: "", title: "", sections: [], closing: "" };

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.*)$/;
const HEADING = /^\s*(#{1,4})\s+(.*)$/;
const RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;

function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

/** "4 × 10-ft sticks ¾" EMT (verify the size)" → its count, name and note. */
export function readItem(text: string, id: string): MaterialItem {
  let rest = plain(text);
  let note = "";
  // A note is a bracket at the very end, as ChatGPT writes "(if required)".
  const bracket = rest.match(/^(.*\S)\s*\(([^()]*)\)\s*$/);
  if (bracket && bracket[1].length > 0) {
    rest = bracket[1].trim();
    note = bracket[2].trim();
  }
  let qty = "";
  const counted = rest.match(/^([0-9½¼¾⅛][^×]{0,20}?)\s+[×x]\s+(.+)$/);
  if (counted) {
    qty = counted[1].trim();
    rest = counted[2].trim();
  }
  return {
    id,
    qty: qty.slice(0, LIMITS.qty),
    name: rest.slice(0, LIMITS.name),
    note: note.slice(0, LIMITS.note),
  };
}

/**
 * Read the model's text into a list. Forgiving by design: a line it cannot
 * place becomes text in the section it sits in, never lost.
 */
export function parseMaterialList(markdown: string, idPrefix = "m"): MaterialList {
  const list: MaterialList = { intro: "", title: "", sections: [], closing: "" };
  const introLines: string[] = [];
  const closingLines: string[] = [];
  let section: MaterialSection | null = null;
  let inClosing = false;
  let itemCount = 0;

  const addText = (line: string) => {
    if (!section) return;
    const last = section.blocks[section.blocks.length - 1];
    if (last && last.type === "text") last.text = `${last.text}\n${line}`;
    else section.blocks.push({ type: "text", text: line });
  };

  for (const raw of markdown.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      // A blank line ends a paragraph, so the next line starts a new one.
      if (section && section.blocks.length > 0 && section.blocks[section.blocks.length - 1].type === "text") {
        section.blocks.push({ type: "text", text: "" });
      }
      continue;
    }
    if (RULE.test(line)) {
      if (list.title || section) inClosing = true;
      continue;
    }
    if (inClosing) {
      const bullet = line.match(BULLET);
      closingLines.push(plain(bullet ? bullet[1] : line));
      continue;
    }

    const heading = line.match(HEADING);
    if (heading) {
      const text = plain(heading[2]).slice(0, LIMITS.title);
      if (heading[1].length === 1 && !list.title && list.sections.length === 0) {
        list.title = text;
      } else if (list.sections.length < LIMITS.sections) {
        section = { id: `${idPrefix}s${list.sections.length}`, heading: text, blocks: [] };
        list.sections.push(section);
      }
      continue;
    }

    const bullet = line.match(BULLET);
    if (bullet && section) {
      const last = section.blocks[section.blocks.length - 1];
      const block = last && last.type === "items" ? last : null;
      const items = block ? block.items : [];
      if (!block) section.blocks.push({ type: "items", items });
      if (itemCount < LIMITS.items * LIMITS.sections) {
        items.push(readItem(bullet[1], `${idPrefix}i${itemCount}`));
        itemCount += 1;
      }
      continue;
    }

    if (!section) {
      // Before any section: the opening line, or the title written without a #.
      introLines.push(plain(bullet ? bullet[1] : line));
      continue;
    }
    addText(plain(line));
  }

  list.intro = introLines.join("\n").slice(0, LIMITS.text);
  // A title the model forgot to mark is usually the opening line's last
  // sentence-free line, like "Pacific Plains Electric — Material List".
  if (!list.title && introLines.length > 1 && !/[.!?:]$/.test(introLines[introLines.length - 1])) {
    list.title = introLines[introLines.length - 1].slice(0, LIMITS.title);
    list.intro = introLines.slice(0, -1).join("\n").slice(0, LIMITS.text);
  }
  list.closing = closingLines.join("\n").slice(0, LIMITS.text);
  for (const each of list.sections) {
    each.blocks = each.blocks
      .map((block) => (block.type === "text" ? { ...block, text: block.text.trim().slice(0, LIMITS.text) } : block))
      .filter((block) => (block.type === "text" ? block.text.length > 0 : block.items.length > 0))
      .slice(0, LIMITS.blocks);
  }
  return list;
}

/** A short line that names something rather than says something. */
function readsAsHeading(line: string): boolean {
  const text = plain(line);
  return (
    text.length >= 2 &&
    text.length <= 70 &&
    text.split(" ").length <= 9 &&
    !/[.!?:;,]$/.test(text) &&
    !text.includes("×") &&
    /^[\p{Lu}\d]/u.test(text)
  );
}

/**
 * A list pasted from ChatGPT's own chat. Copied from the page rather than
 * with its copy button, it loses the "#" marks, and its headings come out as
 * plain short lines. When the text marks no headings, a short line that is
 * not a sentence and not a bullet is read as one (the first, before any
 * bullet, as the title when it names a list), and ChatGPT's closing offer
 * ("If you want, I can: …") is left off.
 */
export function readPastedMaterialList(text: string, idPrefix = "p"): MaterialList {
  const marked = parseMaterialList(text, idPrefix);
  if (hasContent(marked)) return marked;
  const lines = text.replace(/\r/g, "").split("\n");
  const offer = lines.findIndex((line, index) => index > 0 && /^\s*(?:if you(?:'d| would)? (?:like|want)|want me to|would you like)\b/i.test(line));
  let seenBullet = false;
  let titled = false;
  const headed = (offer > 0 ? lines.slice(0, offer) : lines).map((line) => {
    if (BULLET.test(line)) {
      seenBullet = true;
      return line;
    }
    if (!line.trim() || RULE.test(line) || !readsAsHeading(line)) return line;
    if (!titled && !seenBullet && /\blist\b/i.test(line)) {
      titled = true;
      return `# ${line.trim()}`;
    }
    return `## ${line.trim()}`;
  });
  return parseMaterialList(headed.join("\n"), idPrefix);
}

/** One item as it reads in the list: "4 × 10-ft sticks ¾" EMT (note)". */
export function itemLine(item: Pick<MaterialItem, "qty" | "name" | "note">): string {
  const counted = item.qty ? `${item.qty} × ${item.name}` : item.name;
  return item.note ? `${counted} (${item.note})` : counted;
}

/** The list written back out in the same format, to copy or to revise. */
export function materialListMarkdown(list: MaterialList): string {
  const parts: string[] = [];
  if (list.intro) parts.push(list.intro);
  if (list.title) parts.push(`# ${list.title}`);
  for (const section of list.sections) {
    const lines = [`## ${section.heading}`];
    for (const block of section.blocks) {
      if (block.type === "text") lines.push(block.text);
      else lines.push(block.items.map((item) => `- ${itemLine(item)}`).join("\n"));
    }
    parts.push(lines.join("\n"));
  }
  if (list.closing) parts.push(`---\n${list.closing}`);
  return parts.join("\n\n");
}

export function listItems(list: MaterialList): MaterialItem[] {
  return list.sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.type === "items" ? block.items : [])),
  );
}

/**
 * A section of things to check rather than buy, like "Before Installation
 * Day". ("I'd Buy Before the Job" is a buying list and is not one.)
 */
export function isChecklist(section: Pick<MaterialSection, "heading">): boolean {
  return /^\s*before\b|checklist|to (?:verify|check|confirm)\b/i.test(section.heading);
}

/** The items that can go on an estimate: every bullet outside the checklists. */
export function estimateItems(list: MaterialList): MaterialItem[] {
  return listItems({ ...list, sections: list.sections.filter((section) => !isChecklist(section)) });
}

export function hasContent(list: MaterialList): boolean {
  return list.sections.length > 0;
}

/**
 * A list sent back from the browser after an edit, checked into shape: the
 * same limits as a list the model wrote, and nothing but the fields it has.
 */
export function normalizeMaterialList(raw: unknown): MaterialList | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  const str = (input: unknown, max: number) => (typeof input === "string" ? input.trim().slice(0, max) : "");
  const sections: MaterialSection[] = [];
  for (const rawSection of Array.isArray(value.sections) ? value.sections.slice(0, LIMITS.sections) : []) {
    if (!rawSection || typeof rawSection !== "object") continue;
    const s = rawSection as Record<string, unknown>;
    const blocks: MaterialBlock[] = [];
    for (const rawBlock of Array.isArray(s.blocks) ? s.blocks.slice(0, LIMITS.blocks) : []) {
      if (!rawBlock || typeof rawBlock !== "object") continue;
      const b = rawBlock as Record<string, unknown>;
      if (b.type === "text") {
        const text = str(b.text, LIMITS.text);
        if (text) blocks.push({ type: "text", text });
      } else if (b.type === "items" && Array.isArray(b.items)) {
        const items: MaterialItem[] = [];
        for (const rawItem of b.items.slice(0, LIMITS.items)) {
          if (!rawItem || typeof rawItem !== "object") continue;
          const i = rawItem as Record<string, unknown>;
          const name = str(i.name, LIMITS.name);
          if (!name) continue;
          const item: MaterialItem = { id: str(i.id, 40) || `e${items.length}`, qty: str(i.qty, LIMITS.qty), name, note: str(i.note, LIMITS.note) };
          // Prices stay only while they are still this item's, and sane.
          const prices = readItemPrices(i.prices, itemPriceKey(item));
          if (prices) item.prices = prices;
          items.push(item);
        }
        if (items.length > 0) blocks.push({ type: "items", items });
      }
    }
    const heading = str(s.heading, LIMITS.title);
    if (heading || blocks.length > 0) sections.push({ id: str(s.id, 40) || `es${sections.length}`, heading, blocks });
  }
  return {
    intro: str(value.intro, LIMITS.text),
    title: str(value.title, LIMITS.title),
    sections,
    closing: str(value.closing, LIMITS.text),
  };
}

const UNIT_WORDS: Record<string, string> = {
  ft: "ft", feet: "ft", foot: "ft", "'": "ft",
  box: "box", boxes: "box",
  roll: "roll", rolls: "roll",
  stick: "stick", sticks: "stick",
  ea: "each", each: "each",
};

const FRACTIONS: Record<string, number> = { "½": 0.5, "¼": 0.25, "¾": 0.75, "⅛": 0.125 };

// A count at the start of the count field: "1 1/2", "1½", "1/2", "40", "2.5"
// or "½", longest form first, so "1 1/2" is never read as 1.
const COUNT = /^(\d+\s+\d+\/\d+|\d+\s*[½¼¾⅛]|\d+\/\d+|\d+(?:\.\d+)?|[½¼¾⅛])(?![\d./])\s*(.*)$/;

function countValue(text: string): number {
  const mixed = text.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const glyph = text.match(/^(\d*)\s*([½¼¾⅛])$/);
  if (glyph) return Number(glyph[1] || 0) + FRACTIONS[glyph[2]];
  const fraction = text.match(/^(\d+)\/(\d+)$/);
  if (fraction) return Number(fraction[1]) / Number(fraction[2]);
  return Number(text);
}

/**
 * An item as an estimate line: how many, in which unit, and what it is. The
 * price comes from the store prices, or from the person adding it.
 */
export function estimateLineFor(item: Pick<MaterialItem, "qty" | "name">): {
  description: string;
  quantity: string;
  unit: string;
} {
  const name = item.name.trim();
  const match = item.qty.trim().match(COUNT);
  const value = match ? countValue(match[1]) : NaN;
  if (!match || !Number.isFinite(value) || value <= 0) return { description: name, quantity: "1", unit: "each" };

  const rest = match[2].trim();
  const quantity = String(Math.round(value * 1000) / 1000);
  const word = rest.toLowerCase().replace(/\.$/, "");
  const unit = UNIT_WORDS[word] ?? (word ? "" : /^\d+-ft sticks?\b/i.test(name) ? "stick" : "each");
  return unit
    ? { description: name, quantity, unit }
    // A count in some other unit ("1 tube") keeps the unit in the description.
    : { description: `${name} (${rest})`, quantity, unit: "each" };
}

/**
 * Which item a store price is for: what it is, and what one of it is. A new
 * count keeps the price (one still costs the same); a new name or unit does
 * not.
 */
export function itemPriceKey(item: Pick<MaterialItem, "qty" | "name">): { key: string; unit: string } {
  const line = estimateLineFor(item);
  return { key: priceKey(line.description, line.unit), unit: line.unit };
}

/** The item without prices that belong to what it used to be. */
export function withCurrentPrices(item: MaterialItem): MaterialItem {
  if (!item.prices || item.prices.key === itemPriceKey(item).key) return item;
  const rest = { ...item };
  delete rest.prices;
  return rest;
}

function eachItem(list: MaterialList, change: (item: MaterialItem) => MaterialItem): MaterialList {
  return {
    ...list,
    sections: list.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block) => (block.type === "items" ? { ...block, items: block.items.map(change) } : block)),
    })),
  };
}

/**
 * Prices looked up for some items, put on the list as it is now: only on an
 * item that is still there and still the same thing. A store picked by hand
 * stays picked while that store still has a price.
 */
export function applyPrices(list: MaterialList, found: Record<string, ItemPrices>): MaterialList {
  return eachItem(list, (item) => {
    const prices = found[item.id];
    if (!prices || prices.key !== itemPriceKey(item).key) return item;
    const use = item.prices?.use;
    const next: ItemPrices = { ...prices };
    delete next.use;
    if (use && prices[use]) next.use = use;
    return { ...item, prices: next };
  });
}

/**
 * A revised list keeps the prices of everything that did not change, so only
 * new or changed items are looked up again.
 */
export function carryPrices(previous: MaterialList, next: MaterialList): MaterialList {
  const known = new Map<string, ItemPrices>();
  for (const item of listItems(previous)) {
    if (item.prices && item.prices.key === itemPriceKey(item).key) known.set(item.prices.key, item.prices);
  }
  if (known.size === 0) return next;
  return eachItem(next, (item) => {
    const prices = item.prices ? null : known.get(itemPriceKey(item).key);
    return prices ? { ...item, prices } : item;
  });
}

/** The items on the estimate side of the list that have not been looked up as they are now. */
export function unpricedItems(list: MaterialList): MaterialItem[] {
  return estimateItems(list).filter((item) => !item.prices || item.prices.key !== itemPriceKey(item).key);
}

/**
 * What the model is told. Written to get the list the way ChatGPT gives it to
 * this electrician, not a generic shopping list.
 */
export function materialListInstructions(businessName: string): string {
  return [
    `You help ${businessName || "a residential electrical contractor"}, a licensed electrical contractor in the United States, put together the materials for a job.`,
    "Write the list exactly in this plain-text format, and nothing else:",
    "",
    "One or two sentences saying what installation you are stocking for (or, when revising, what you changed).",
    `# ${businessName || "Business name"} — <Job> Material List`,
    "## <Section heading>",
    "An optional short line before the bullets, e.g. \"I'd buy 40 ft rather than exactly 30 ft so you have room for bends.\"",
    "- 4 × 10-ft sticks ¾\" EMT",
    "- 40 ft × #10 THHN/THWN-2 Black",
    "- 1 × 30A, 2-pole, non-fused A/C disconnect — NEMA 3R (verify the nameplate MOCP)",
    "- Duct seal",
    "An optional short line after the bullets.",
    "---",
    "A closing note when there is one thing worth flagging.",
    "",
    "Rules:",
    "- Group materials into sections the way an electrician buys them: breaker and disconnect, raceway and fittings, conductors, supports and hardware, terminations, weatherproofing and finish materials, whatever the job needs.",
    "- Each material is one bullet: the count, then \" × \", then the item with its size and rating. A count can carry a unit (\"40 ft\", \"1 box\"). Leave the count off only for consumables like duct seal or tape.",
    "- Anything to check about an item goes in brackets at the end of its bullet, e.g. (if required) or (verify compatibility with the panel).",
    "- Buy a little over the measured run for bends and routing, and say so in a short line.",
    "- After the material sections, add \"## I'd Buy Before the Job\" with the definite purchases, then a line \"Keep on the truck in case the routing changes:\" and the contingency items as bullets.",
    "- Then add \"## Before Installation Day\" with bullets of what to verify: equipment nameplate MCA and MOCP, breaker compatibility with the panel, open breaker spaces, the route, permits.",
    "- Follow the NEC. Never present a conductor or breaker size as final when it depends on equipment the electrician has not confirmed: say to verify it against the nameplate.",
    "- Use \" for inches and the × sign for counts. No tables, no bold, no emoji, no prices.",
    "- Do not end with offers like \"If you want, I can…\".",
    "- When asked for changes, write the whole list again with the changes made, keeping everything else exactly as it was, including any item the electrician edited by hand.",
  ].join("\n");
}

/** What the job record says about the work, so the first request can be short. */
export function materialJobFacts(job: {
  category?: unknown;
  customerDescription?: unknown;
  technicianNotes?: unknown;
  city?: unknown;
  state?: unknown;
}): string[] {
  const say = (value: unknown) => (typeof value === "string" ? value.trim() : "");
  return [
    say(job.category) ? `Kind of job: ${say(job.category).replace(/_/g, " ")}` : "",
    say(job.customerDescription) ? `What the customer asked for: ${say(job.customerDescription).slice(0, 1500)}` : "",
    say(job.technicianNotes) ? `The electrician's notes: ${say(job.technicianNotes).slice(0, 1500)}` : "",
    say(job.city) ? `Where: ${[say(job.city), say(job.state)].filter(Boolean).join(", ")}` : "",
  ].filter(Boolean);
}

/**
 * Everything ChatGPT needs to write or revise this job's list in its own
 * chat: the format, the job, and the list as it stands. The electrician adds
 * what they want after the last line.
 */
export function chatGptMaterialPrompt(input: { businessName: string; facts: string[]; list: MaterialList }): string {
  const revising = hasContent(input.list);
  return [
    materialListInstructions(input.businessName),
    input.facts.length ? `\nThis job, from the job record:\n${input.facts.join("\n")}` : "",
    revising ? `\nThe list as it stands now:\n\n${materialListMarkdown(input.list)}` : "",
    revising ? "\nWhat I want changed:" : "\nThe job:",
  ]
    .filter(Boolean)
    .join("\n");
}

/** The last few turns of the chat, the most a list keeps. */
export function keptTurns(turns: ChatTurn[]): ChatTurn[] {
  return turns.slice(-20).map((turn) => ({ ...turn, text: turn.text.slice(0, 2000) }));
}
