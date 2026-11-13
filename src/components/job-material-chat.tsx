"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import {
  Check,
  ChevronDown,
  ClipboardCopy,
  ExternalLink,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  Sparkles,
  Tag,
  X,
} from "lucide-react";

import { addListedParts, type ListedPart } from "@/app/jobs/[jobId]/line-actions";
import { AiLimitActions } from "@/components/ai-limit-actions";
import { clearMaterialList, saveMaterialList } from "@/app/jobs/[jobId]/material-list-actions";
import {
  estimateLineFor,
  hasContent,
  itemLine,
  estimateItems,
  isChecklist,
  listItems,
  parseMaterialList,
  withCurrentPrices,
  type ChatTurn,
  type MaterialItem,
  type MaterialList,
} from "@/lib/material-list";
import type { SavedMaterialList } from "@/lib/material-list-server";
import { PART_UNITS } from "@/lib/stock-reservation";
import { SelectField } from "@/components/ui/select-field";
import {
  STORE_NAMES,
  STORES,
  chosenStorePrice,
  listedItemPricing,
  dollarsText,
  storePricing,
  type ItemPrices,
  type StoreName,
} from "@/lib/store-price-rules";

/**
 * The materials chat on a job: say what the job is, get the list back the way
 * ChatGPT writes it, ask for changes, and tap any item to fix it by hand.
 * Each item is then looked up at Home Depot and Lowe's, and chosen items go
 * onto the estimate already priced: the store price plus the markup.
 *
 * The list is typed here by hand, or written in ChatGPT through Volteira's
 * connection (save_materials_list), which saves it straight to the job. The
 * built-in writer and the copy-and-paste from ChatGPT are switched off.
 */

type Props = {
  jobNumber: string;
  saved: SavedMaterialList;
  /** Percent added to a store price for the customer's price. */
  markupPercent: number;
  /** What a prompt for ChatGPT's own chat says about the business and the job. */
  forChatGpt: { businessName: string; facts: string[] };
  jobDescription: string;
  hasLines: boolean;
  /** Start folded whatever the list says: a diagnostic with no repair on it buys nothing. */
  startFolded?: boolean;
};

/** "Home Depot $5.98/ft · Lowe's $6.48/ft", each a link to the product page. */
function StorePrices({ prices }: { prices: ItemPrices | undefined }) {
  if (!prices) return null;
  if (!prices.homeDepot && !prices.lowes) {
    return <span className="block text-xs text-ink-faint">No Home Depot or Lowe&apos;s price found</span>;
  }
  const chosen = chosenStorePrice(prices);
  return (
    <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-ink-muted">
      {STORE_NAMES.map((store) => {
        const price = prices[store];
        if (!price) return null;
        return (
          <a
            key={store}
            href={price.url}
            target="_blank"
            rel="noopener noreferrer"
            title={price.product || undefined}
            className={`inline-flex min-h-6 items-center gap-1 hover:text-ink ${chosen?.store === store ? "font-semibold text-ink" : ""}`}
          >
            {STORES[store].label} ${dollarsText(price.cents)}
            {price.per !== "each" ? `/${price.per}` : ""}
            <ExternalLink className="h-3 w-3 opacity-60" aria-hidden />
          </a>
        );
      })}
    </span>
  );
}

function copyText(list: MaterialList): string {
  const parts: string[] = [];
  if (list.intro) parts.push(list.intro);
  if (list.title) parts.push(list.title);
  for (const section of list.sections) {
    const lines = [section.heading];
    for (const block of section.blocks) {
      if (block.type === "text") lines.push(block.text);
      else lines.push(block.items.map((item) => `• ${itemLine(item)}`).join("\n"));
    }
    parts.push(lines.join("\n"));
  }
  if (list.closing) parts.push(list.closing);
  return parts.join("\n\n");
}

function mapItems(list: MaterialList, change: (items: MaterialItem[], blockKey: string) => MaterialItem[]): MaterialList {
  return {
    ...list,
    sections: list.sections.map((section) => ({
      ...section,
      blocks: section.blocks.map((block, index) =>
        block.type === "items" ? { ...block, items: change(block.items, `${section.id}:${index}`) } : block,
      ),
    })),
  };
}

function ItemEditor({
  item,
  onSave,
  onRemove,
  onCancel,
}: {
  item: MaterialItem;
  onSave: (item: MaterialItem) => void;
  onRemove?: () => void;
  onCancel: () => void;
}) {
  const [qty, setQty] = useState(item.qty);
  const [name, setName] = useState(item.name);
  const [note, setNote] = useState(item.note);
  const [cost, setCost] = useState(item.costCents !== undefined ? (item.costCents / 100).toFixed(2) : "");
  const costCents = cost.trim() === "" ? undefined : Math.round(Number(cost.replace(/[$,\s]/g, "")) * 100);
  const costOk = costCents === undefined || (Number.isFinite(costCents) && costCents >= 0 && costCents <= 1_000_000);
  const field = "min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm";
  // Names and notes run long ("Eaton BR220 — 20A, 2-pole breaker"), so they
  // get room to be read whole rather than a one-line box that scrolls.
  const area = "min-h-11 w-full resize-y rounded-control border border-line bg-raised px-3 py-2.5 text-sm leading-5";
  return (
    <div className="my-1.5 rounded-control border border-brand/50 bg-brand/[0.05] p-2.5">
      <div className="grid grid-cols-[5.5rem_1fr] gap-2">
        <label className="text-xs text-ink-muted">
          How many
          <input value={qty} onChange={(event) => setQty(event.target.value)} placeholder="4" className={`${field} mt-1`} />
        </label>
        <label className="text-xs text-ink-muted">
          Item
          <textarea value={name} rows={2} onChange={(event) => setName(event.target.value)} placeholder='10-ft sticks ¾" EMT' className={`${area} mt-1`} autoFocus />
        </label>
      </div>
      <label className="mt-2 block text-xs text-ink-muted">
        Cost each (what you pay)
        <input
          value={cost}
          inputMode="decimal"
          onChange={(event) => setCost(event.target.value)}
          placeholder="$0.00"
          className={`${field} mt-1`}
        />
        {!costOk ? <span className="mt-1 block text-critical">Enter a price like 12.50.</span> : null}
      </label>
      <label className="mt-2 block text-xs text-ink-muted">
        Note
        <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)} placeholder="verify with the panel labeling" className={`${area} mt-1`} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!name.trim() || !costOk}
          onClick={() => {
            const saved: MaterialItem = { ...item, qty: qty.trim(), name: name.trim(), note: note.trim() };
            if (costCents === undefined) delete saved.costCents;
            else saved.costCents = costCents;
            onSave(saved);
          }}
          className="tap-target inline-flex min-h-11 items-center gap-1.5 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
        >
          <Check className="h-4 w-4" aria-hidden />
          Save
        </button>
        <button type="button" onClick={onCancel} className="tap-target inline-flex min-h-11 items-center px-3 text-sm font-semibold text-ink-muted">
          Cancel
        </button>
        {onRemove ? (
          <button type="button" onClick={onRemove} className="tap-target ml-auto inline-flex min-h-11 items-center px-3 text-sm font-semibold text-critical">
            Remove
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** The list, drawn the way ChatGPT lays it out. */
function ListView({
  list,
  live,
  editingId,
  choosing,
  chosen,
  frozen,
  onEdit,
  onToggle,
  onSaveItem,
  onRemoveItem,
  onAddItem,
  addingTo,
  onStartAdd,
}: {
  list: MaterialList;
  live: boolean;
  editingId: string | null;
  choosing: boolean;
  chosen: Set<string>;
  /** The picks are being priced: they stay as they are until the sheet closes. */
  frozen: boolean;
  onEdit: (id: string | null) => void;
  onToggle: (id: string) => void;
  onSaveItem: (item: MaterialItem) => void;
  onRemoveItem: (id: string) => void;
  onAddItem: (blockKey: string, item: MaterialItem) => void;
  addingTo: string | null;
  onStartAdd: (blockKey: string | null) => void;
}) {
  return (
    <div className="text-sm leading-6">
      {list.intro ? <p className="whitespace-pre-line text-ink-muted">{list.intro}</p> : null}
      {list.title ? <h3 className="mt-3 text-base font-semibold">{list.title}</h3> : null}
      {list.sections.map((section) => (
        <section key={section.id} className="mt-4">
          <h4 className="font-semibold">{section.heading}</h4>
          {choosing && isChecklist(section) ? <p className="text-xs text-ink-faint">Things to check, not to buy: not added to the estimate.</p> : null}
          {section.blocks.map((block, index) => {
            const blockKey = `${section.id}:${index}`;
            if (block.type === "text") {
              return (
                <p key={blockKey} className="mt-1 whitespace-pre-line text-ink-muted">
                  {block.text}
                </p>
              );
            }
            return (
              <div key={blockKey}>
                <ul className="mt-1 list-disc space-y-0.5 pl-5 marker:text-ink-faint">
                  {block.items.map((item) =>
                    editingId === item.id ? (
                      <li key={item.id} className="list-none -ml-5">
                        <ItemEditor item={item} onSave={onSaveItem} onRemove={() => onRemoveItem(item.id)} onCancel={() => onEdit(null)} />
                      </li>
                    ) : choosing && isChecklist(section) ? (
                      <li key={item.id} className="py-1 text-ink-muted">
                        {item.qty ? `${item.qty} × ` : ""}
                        {item.name}
                      </li>
                    ) : choosing ? (
                      <li key={item.id} className="list-none -ml-5">
                        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-control px-1 py-1.5 hover:bg-white/[0.04]">
                          <input type="checkbox" checked={chosen.has(item.id)} disabled={frozen} onChange={() => onToggle(item.id)} className="mt-1 h-4 w-4 shrink-0 disabled:opacity-60" />
                          <span>
                            {item.qty ? `${item.qty} × ` : ""}
                            {item.name}
                            {item.note ? <span className="text-ink-faint"> ({item.note})</span> : null}
                            {item.costCents !== undefined ? <span className="text-ink-muted"> · ${(item.costCents / 100).toFixed(2)} each</span> : null}
                          </span>
                        </label>
                        {/* Outside the label, so opening a store's page never ticks the box. */}
                        <div className="pl-[1.875rem]">
                          <StorePrices prices={item.prices} />
                        </div>
                      </li>
                    ) : (
                      <li key={item.id}>
                        <button
                          type="button"
                          disabled={live}
                          onClick={() => onEdit(item.id)}
                          aria-label={`Edit ${itemLine(item)}`}
                          className="group -mx-1 flex min-h-9 w-full items-start gap-2 rounded px-1 py-1 text-left hover:bg-white/[0.04] disabled:cursor-default disabled:hover:bg-transparent"
                        >
                          <span className="min-w-0 flex-1">
                            {item.qty ? `${item.qty} × ` : ""}
                            {item.name}
                            {item.note ? <span className="text-ink-faint"> ({item.note})</span> : null}
                            {item.costCents !== undefined ? <span className="text-ink-muted"> · ${(item.costCents / 100).toFixed(2)} each</span> : null}
                          </span>
                          {!live ? <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint opacity-60 group-hover:opacity-100" aria-hidden /> : null}
                        </button>
                        {/* Beside the button, not in it: a link inside a button is neither. */}
                        <StorePrices prices={item.prices} />
                      </li>
                    ),
                  )}
                </ul>
                {!live && !choosing ? (
                  addingTo === blockKey ? (
                    <ItemEditor
                      item={{ id: `n${Date.now().toString(36)}`, qty: "", name: "", note: "" }}
                      onSave={(item) => onAddItem(blockKey, item)}
                      onCancel={() => onStartAdd(null)}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => onStartAdd(blockKey)}
                      className="tap-target mt-0.5 inline-flex min-h-9 items-center gap-1 text-xs font-semibold text-ink-muted hover:text-ink"
                    >
                      <Plus className="h-3.5 w-3.5" aria-hidden />
                      Add item
                    </button>
                  )
                ) : null}
              </div>
            );
          })}
        </section>
      ))}
      {list.closing ? <p className="mt-4 whitespace-pre-line border-t border-line pt-3 text-ink-muted">{list.closing}</p> : null}
    </div>
  );
}

/** A row on the sheet, with the store prices it can be filled from and the store picked. */
type PricedRow = ListedPart & { prices?: ItemPrices; pick: StoreName | null; store: StoreName | null };

function PricingSheet({
  jobNumber,
  items,
  markupPercent,
  onPickStore,
  onDone,
  onCancel,
}: {
  jobNumber: string;
  items: MaterialItem[];
  markupPercent: number;
  /** Remember which store an item is priced from. */
  onPickStore: (itemId: string, store: StoreName) => void;
  onDone: (notice: string) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<PricedRow[]>(() =>
    items.map((item) => {
      const line = estimateLineFor(item);
      const pick = item.prices?.use ?? null;
      return {
        itemId: item.id,
        description: line.description,
        quantity: line.quantity,
        unit: line.unit,
        prices: item.prices,
        pick,
        ...listedItemPricing(item, pick, line.unit, markupPercent),
      };
    }),
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const field = "min-h-11 w-full rounded-control border border-line bg-raised px-2.5 text-sm";
  const update = (index: number, change: Partial<PricedRow>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));
  const anyStorePrice = rows.some((row) => row.store);

  return (
    <div className="mt-4 rounded-control border border-line bg-white/[0.02] p-3">
      <p className="text-sm font-semibold">Price each item for the estimate</p>
      <p className="mt-0.5 text-xs text-ink-muted">
        What the customer pays for one. Type 0 for no charge.
        {anyStorePrice ? (
          <>
            {" "}
            Filled in from the higher store price plus your {markupPercent}% markup (
            <Link href="/settings/business" className="font-semibold text-brand">
              Settings → Business
            </Link>
            ). Change any price before adding.
          </>
        ) : null}
      </p>
      {/* Locked while adding: what is added is exactly what is shown. */}
      <fieldset disabled={pending} className="contents">
        <ul className="mt-3 space-y-3 [&_:disabled]:opacity-60">
          {rows.map((row, index) => (
            <li key={row.itemId} className="rounded-control border border-line p-2.5">
              <input
                value={row.description}
                onChange={(event) => update(index, { description: event.target.value })}
                aria-label="Description"
                className={field}
              />
              <div className="mt-2 grid grid-cols-3 gap-2">
                <label className="text-xs text-ink-muted">
                  Qty
                  <input value={row.quantity} inputMode="decimal" onChange={(event) => update(index, { quantity: event.target.value })} className={`${field} mt-1`} />
                </label>
                <div className="text-xs text-ink-muted">
                  <span>Unit</span>
                  <div className="mt-1">
                    <SelectField
                      label="Unit"
                      value={row.unit}
                      onChange={(unit) => {
                        // A store price is for one unit: in another, it is filled
                        // again or cleared, never carried over.
                        update(index, row.prices && (row.prices.homeDepot || row.prices.lowes) ? { unit, ...storePricing(row.prices, row.pick, unit, markupPercent) } : { unit });
                      }}
                      choices={PART_UNITS.map((unit) => ({ value: unit, label: unit }))}
                    />
                  </div>
                </div>
                <label className="text-xs text-ink-muted">
                  Price each
                  <input
                    value={row.unitPrice}
                    inputMode="decimal"
                    placeholder="$"
                    onChange={(event) => update(index, { unitPrice: event.target.value })}
                    className={`${field} mt-1`}
                  />
                </label>
              </div>
              {row.prices && (row.prices.homeDepot || row.prices.lowes) ? (
                <div className="mt-2 flex flex-wrap items-center gap-1.5" role="group" aria-label={`Store price for ${row.description}`}>
                  <Tag className="h-3.5 w-3.5 text-ink-faint" aria-hidden />
                  {STORE_NAMES.map((store) => {
                    const price = row.prices?.[store];
                    if (!price) return null;
                    const picked = row.store === store;
                    return (
                      <span key={store} className="inline-flex items-center">
                        <button
                          type="button"
                          aria-pressed={picked}
                          onClick={() => {
                            update(index, { pick: store, ...storePricing(row.prices, store, row.unit, markupPercent) });
                            onPickStore(row.itemId, store);
                          }}
                          className={`tap-target inline-flex min-h-9 items-center rounded-l-chip border px-2.5 text-xs font-semibold ${
                            picked ? "border-brand bg-brand/[0.12] text-ink" : "border-line text-ink-muted"
                          }`}
                        >
                          {STORES[store].label} ${dollarsText(price.cents)}
                          {price.per !== "each" ? `/${price.per}` : ""}
                        </button>
                        <a
                          href={price.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          aria-label={`Open ${STORES[store].label}'s page for ${price.product || row.description}`}
                          className={`tap-target inline-flex min-h-9 min-w-9 items-center justify-center rounded-r-chip border border-l-0 text-ink-muted ${
                            picked ? "border-brand" : "border-line"
                          }`}
                        >
                          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                        </a>
                      </span>
                    );
                  })}
                </div>
              ) : row.prices ? (
                <p className="mt-2 text-xs text-ink-faint">No Home Depot or Lowe&apos;s price found: type the price.</p>
              ) : null}
              {row.prices && !row.store && chosenStorePrice(row.prices) ? (
                <p className="mt-1.5 text-xs text-ink-faint">
                  Store prices are per {chosenStorePrice(row.prices)?.price.per}: type the price per {row.unit}, or set the unit back.
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </fieldset>
      {error ? <p className="mt-2 text-sm text-critical">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addListedParts(
                jobNumber,
                rows.map((row) => ({
                  itemId: row.itemId,
                  description: row.description,
                  quantity: row.quantity,
                  unit: row.unit,
                  unitPrice: row.unitPrice,
                  unitCost: row.unitCost,
                })),
              );
              if (result.error) setError(result.error);
              else onDone(result.notice ?? "Added to the estimate.");
            })
          }
          className="tap-target inline-flex min-h-12 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          Add {rows.length} to the estimate
        </button>
        {/* Locked while adding: leaving and coming back would let the same
            parts be added twice. */}
        <button
          type="button"
          disabled={pending}
          onClick={onCancel}
          className="tap-target inline-flex min-h-11 items-center px-3 text-sm font-semibold text-ink-muted disabled:opacity-50"
        >
          Back to the list
        </button>
      </div>
    </div>
  );
}


export function JobMaterialChat({ jobNumber, saved, markupPercent, hasLines, startFolded = false }: Props) {
  const [list, setList] = useState<MaterialList>(saved.list);
  const [messages, setMessages] = useState<ChatTurn[]>(saved.messages);
  const [liveText] = useState<string | null>(null);
  const [pendingPrompt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pricing, setPricing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [clearing, setClearing] = useState(false);
  // Open or folded is decided once, as the page loads: adding items to the
  // estimate gives the job lines, and that must not fold the chat shut under
  // the person using it.
  const [startsOpen] = useState(() => !startFolded && (!hasContent(saved.list) || !hasLines));
  // Typing the list by hand, item by item, with no AI at all.
  const [typing, setTyping] = useState(false);
  // The first typed item's id, made once rather than on every render.
  const [firstItemId] = useState(() => `n${Date.now().toString(36)}`);
  // "Add materials to estimate" on the Estimate card opens this list with its
  // items to tick, then prices the ticked ones onto the estimate.
  const card = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const choose = () => {
      setEditingId(null);
      setAddingTo(null);
      setNotice("");
      setChoosing(true);
      let fold: HTMLElement | null = card.current;
      while (fold) {
        if (fold instanceof HTMLDetailsElement) fold.open = true;
        fold = fold.parentElement?.closest("details") ?? null;
      }
      card.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    };
    window.addEventListener("volteira:choose-materials", choose);
    return () => window.removeEventListener("volteira:choose-materials", choose);
  }, []);
  const abort = useRef<AbortController | null>(null);
  // The list as it is on screen now, for prices that arrive a minute later.
  const listNow = useRef(list);
  useEffect(() => {
    listNow.current = list;
  }, [list]);

  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  const writing = liveText !== null;
  const shown = writing ? parseMaterialList(liveText ?? "", "live") : list;
  const items = listItems(list);
  // What can be priced, and which of those are ticked: only ever items on the
  // list as it is now, so a stale pick never counts.
  const priceable = estimateItems(list);
  const picked = priceable.filter((item) => chosen.has(item.id));
  const listed = hasContent(list);

  // Writes to the saved list go one at a time, in the order they were made, so
  // an earlier edit can never land after a later one, and a revision waits for
  // the last edit before the server reads the list it revises.
  const saving = useRef<Promise<unknown>>(Promise.resolve());
  function inOrder<T>(write: () => Promise<T>): Promise<T> {
    const next = saving.current.then(write);
    saving.current = next.catch(() => undefined);
    return next;
  }

  // Whether the list on screen holds an edit the server has not kept. Every
  // save carries the whole list, so a later one that sticks clears it.
  const unsaved = useRef(false);
  // The saved version this screen's list was built on; each save names it,
  // so one made on an old copy is refused rather than replacing a newer list.
  const version = useRef<string | null>(saved.updatedAt);
  // Bumped whenever the list on screen is replaced (cleared, or swapped for
  // the server's newer one): saves still queued from before are dropped.
  const generation = useRef(0);

  // The list as the server has it now, in place of this screen's copy.
  function adopt(current: SavedMaterialList) {
    generation.current += 1;
    version.current = current.updatedAt;
    unsaved.current = false;
    setList(current.list);
    setMessages(current.messages);
    setChosen(new Set());
    setEditingId(null);
    setAddingTo(null);
  }

  function saveList(next: MaterialList): Promise<void> {
    const madeOn = generation.current;
    return inOrder(async () => {
      if (madeOn !== generation.current) return;
      try {
        const result = await saveMaterialList(jobNumber, next, version.current);
        if (result.current) {
          adopt(result.current);
          setError(result.error);
          return;
        }
        unsaved.current = Boolean(result.error);
        if (result.error) setError(result.error);
        else if (result.updatedAt) version.current = result.updatedAt;
      } catch {
        unsaved.current = true;
        setError("The change could not be saved. Try again.");
      }
    });
  }

  // Start over: nothing on the list can be changed until the clear settles,
  // and an edit queued before it is dropped rather than bringing the list back.
  function startOver() {
    generation.current += 1;
    const asked = generation.current;
    setClearing(true);
    setEditingId(null);
    setAddingTo(null);
    void inOrder(async () => {
      // A save still in flight found a newer list and put it on screen: that
      // list is not the one Start over was asked for, so it is left alone.
      if (asked !== generation.current) return;
      try {
        const result = await clearMaterialList(jobNumber, version.current);
        if (result.current) {
          adopt(result.current);
          setError(result.error);
          return;
        }
        if (result.error) {
          // The list stays; whatever was dropped is saved again before the next change is asked for.
          unsaved.current = true;
          setError(result.error);
          return;
        }
        unsaved.current = false;
        version.current = null;
        setList({ intro: "", title: "", sections: [], closing: "" });
        setMessages([]);
        setChosen(new Set());
      } catch {
        unsaved.current = true;
        setError("The list could not be cleared. Try again.");
      }
    }).finally(() => setClearing(false));
  }

  // Keep a hand edit, and say so if it did not stick.
  function persist(next: MaterialList) {
    // Before the screen catches up, so prices arriving in between land on this list.
    listNow.current = next;
    setList(next);
    void saveList(next);
  }



  // Everything before the latest request is history; the latest request sits
  // right above the list that answers it.
  const lastAsked = messages.map((turn) => turn.role).lastIndexOf("user");
  const history = (lastAsked >= 0 ? messages.slice(0, lastAsked) : messages).slice(-6);
  const lastPrompt = lastAsked >= 0 ? messages[lastAsked] : undefined;

  return (
    <details ref={card} id="materials-chat" className="group scroll-mt-24" open={startsOpen}>
      <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between gap-3 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="flex items-center gap-1.5 text-sm font-semibold">
            <Sparkles className="h-4 w-4 text-brand" aria-hidden />
            Materials chat
          </span>
          <span className="block truncate text-xs text-ink-muted">
            {listed ? `${list.title || "Materials list"} · ${items.length} items` : "Describe the job and get the list, like ChatGPT"}
          </span>
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-ink-faint transition-transform group-open:rotate-180" aria-hidden />
      </summary>

      <div className="mt-3">
        {/* The conversation so far: earlier requests, with what changed each time. */}
        {history.length > 0 ? (
          <ol className="mb-3 space-y-1.5">
            {history.map((turn, index) => (
              <li
                key={`${turn.at}-${index}`}
                className={
                  turn.role === "user"
                    ? "ml-8 rounded-control bg-brand/[0.10] px-3 py-2 text-sm"
                    : "mr-8 rounded-control bg-white/[0.03] px-3 py-2 text-xs text-ink-muted"
                }
              >
                {turn.text}
              </li>
            ))}
          </ol>
        ) : null}
        {(writing ? pendingPrompt : lastPrompt?.text) ? (
          <p className="mb-3 ml-8 rounded-control bg-brand/[0.10] px-3 py-2 text-sm">{writing ? pendingPrompt : lastPrompt?.text}</p>
        ) : null}

        {hasContent(shown) || writing ? (
          <div className="rounded-control border border-line bg-white/[0.015] p-3 sm:p-4">
            {writing && !hasContent(shown) && !shown.intro ? (
              <p className="flex items-center gap-2 text-sm text-ink-muted" role="status">
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                Writing the list…
              </p>
            ) : (
              <ListView
                list={shown}
                live={writing || clearing}
                editingId={editingId}
                choosing={choosing}
                chosen={chosen}
                frozen={pricing}
                onEdit={(id) => {
                  setAddingTo(null);
                  setEditingId(id);
                }}
                onToggle={(id) =>
                  setChosen((current) => {
                    const next = new Set(current);
                    if (next.has(id)) next.delete(id);
                    else next.add(id);
                    return next;
                  })
                }
                onSaveItem={(edited) => {
                  // A new name or unit is a different thing: its old store prices go.
                  const item = withCurrentPrices(edited);
                  persist(mapItems(list, (blockItems) => blockItems.map((each) => (each.id === item.id ? item : each))));
                  setEditingId(null);
                }}
                onRemoveItem={(id) => {
                  persist(mapItems(list, (blockItems) => blockItems.filter((each) => each.id !== id)));
                  setEditingId(null);
                }}
                addingTo={addingTo}
                onStartAdd={(key) => {
                  setEditingId(null);
                  setAddingTo(key);
                }}
                onAddItem={(blockKey, item) => {
                  persist(mapItems(list, (blockItems, key) => (key === blockKey ? [...blockItems, item] : blockItems)));
                  setAddingTo(null);
                }}
              />
            )}
            {writing && hasContent(shown) ? (
              <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted" role="status">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Writing…
              </p>
            ) : null}
          </div>
        ) : null}

        {listed && !writing ? (
          choosing ? (
            pricing ? (
              <PricingSheet
                jobNumber={jobNumber}
                items={picked}
                markupPercent={markupPercent}
                onPickStore={(itemId, store) =>
                  persist(
                    mapItems(listNow.current, (blockItems) =>
                      blockItems.map((each) => (each.id === itemId && each.prices ? { ...each, prices: { ...each.prices, use: store } } : each)),
                    ),
                  )
                }
                onCancel={() => setPricing(false)}
                onDone={(message) => {
                  setPricing(false);
                  setChoosing(false);
                  setChosen(new Set());
                  setNotice(message);
                }}
              />
            ) : (
              <div className="sticky bottom-20 mt-3 flex flex-wrap items-center gap-2 rounded-control border border-brand/40 bg-surface p-2.5 shadow-lg lg:bottom-4">
                <span className="text-sm">{picked.length} chosen</span>
                <button
                  type="button"
                  onClick={() => setChosen(picked.length > 0 && picked.length === priceable.length ? new Set() : new Set(priceable.map((item) => item.id)))}
                  className="tap-target inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink-muted"
                >
                  {picked.length > 0 && picked.length === priceable.length ? "Clear" : "Choose all"}
                </button>
                <button
                  type="button"
                  disabled={picked.length === 0}
                  onClick={() => setPricing(true)}
                  className="tap-target ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
                >
                  {`Price ${picked.length || ""} for the estimate`}
                </button>
                <button type="button" onClick={() => setChoosing(false)} aria-label="Stop choosing" className="tap-target inline-flex min-h-11 min-w-11 items-center justify-center text-ink-muted">
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
            )
          ) : (
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(copyText(list)).then(() => {
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 2000);
                  });
                }}
                className="tap-target inline-flex min-h-11 items-center gap-1.5 rounded-control border border-line px-3 text-sm font-semibold"
              >
                {copied ? <Check className="h-4 w-4 text-positive" aria-hidden /> : <ClipboardCopy className="h-4 w-4" aria-hidden />}
                {copied ? "Copied" : "Copy list"}
              </button>
              <button
                type="button"
                disabled={clearing}
                onClick={() => {
                  if (!window.confirm("Clear this list and the chat, and start again?")) return;
                  startOver();
                }}
                className="tap-target inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-ink-muted disabled:opacity-60"
              >
                {clearing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
                {clearing ? "Clearing…" : "Start over"}
              </button>
            </div>
          )
        ) : null}
        {notice ? (
          <p className="mt-2 text-sm text-positive" role="status">
            {notice} Find them under Work &amp; materials below.
          </p>
        ) : null}

        {error ? <p className="mt-2 text-sm text-critical">{error}</p> : null}
        <AiLimitActions message={error} />

        {!listed && !writing && !choosing && typing ? (
          <div className="mt-3 rounded-control border border-line bg-white/[0.015] p-3 sm:p-4">
            <p className="mb-2 text-sm font-semibold">First item</p>
            <ItemEditor
              item={{ id: firstItemId, qty: "", name: "", note: "" }}
              onSave={(item) => {
                // A list of one section to start; "Add item" under it takes the rest.
                persist({
                  intro: "",
                  title: "",
                  sections: [{ id: `s${Date.now().toString(36)}`, heading: "Materials", blocks: [{ type: "items", items: [item] }] }],
                  closing: "",
                });
                setTyping(false);
              }}
              onCancel={() => setTyping(false)}
            />
          </div>
        ) : null}

        {!listed && !writing && !choosing && !typing ? (
          <button
            type="button"
            disabled={clearing}
            onClick={() => {
              setError("");
              setTyping(true);
            }}
            className="tap-target mt-1 mr-4 inline-flex min-h-10 items-center gap-1.5 text-xs font-semibold text-brand disabled:opacity-50"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Type the list yourself
          </button>
        ) : null}

      </div>
    </details>
  );
}
