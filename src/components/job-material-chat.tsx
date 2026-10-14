"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";
import { Check, ChevronDown, ClipboardCopy, ListChecks, LoaderCircle, Pencil, Plus, RotateCcw, SendHorizontal, Sparkles, X } from "lucide-react";

import { addListedParts, type ListedPart } from "@/app/jobs/[jobId]/line-actions";
import { clearMaterialList, saveMaterialList } from "@/app/jobs/[jobId]/material-list-actions";
import {
  estimateLineFor,
  hasContent,
  itemLine,
  listItems,
  parseMaterialList,
  type ChatTurn,
  type MaterialItem,
  type MaterialList,
} from "@/lib/material-list";
import type { SavedMaterialList } from "@/lib/material-list-server";
import { PART_UNITS } from "@/lib/stock-reservation";

/**
 * The materials chat on a job: say what the job is, get the list back the way
 * ChatGPT writes it, ask for changes, and tap any item to fix it by hand.
 * Chosen items go onto the estimate with a price each.
 *
 * The reply streams in and is drawn as it arrives, sections and bullets and
 * all, so it feels like the chat the electrician already uses.
 */

const END = "\u001e";

type Props = {
  jobNumber: string;
  saved: SavedMaterialList;
  ai: { connected: boolean; label: string };
  canConnect: boolean;
  jobDescription: string;
  hasLines: boolean;
};

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
        Note
        <textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)} placeholder="verify with the panel labeling" className={`${area} mt-1`} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={!name.trim()}
          onClick={() => onSave({ ...item, qty: qty.trim(), name: name.trim(), note: note.trim() })}
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
                    ) : choosing ? (
                      <li key={item.id} className="list-none -ml-5">
                        <label className="flex min-h-10 cursor-pointer items-start gap-2.5 rounded-control px-1 py-1.5 hover:bg-white/[0.04]">
                          <input type="checkbox" checked={chosen.has(item.id)} onChange={() => onToggle(item.id)} className="mt-1 h-4 w-4 shrink-0" />
                          <span>
                            {item.qty ? `${item.qty} × ` : ""}
                            {item.name}
                            {item.note ? <span className="text-ink-faint"> ({item.note})</span> : null}
                          </span>
                        </label>
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
                          </span>
                          {!live ? <Pencil className="mt-1 h-3.5 w-3.5 shrink-0 text-ink-faint opacity-60 group-hover:opacity-100" aria-hidden /> : null}
                        </button>
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

function PricingSheet({
  jobNumber,
  items,
  onDone,
  onCancel,
}: {
  jobNumber: string;
  items: MaterialItem[];
  onDone: (notice: string) => void;
  onCancel: () => void;
}) {
  const [rows, setRows] = useState<ListedPart[]>(() =>
    items.map((item) => {
      const line = estimateLineFor(item);
      return { itemId: item.id, description: line.description, quantity: line.quantity, unit: line.unit, unitPrice: "" };
    }),
  );
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();
  const field = "min-h-11 w-full rounded-control border border-line bg-raised px-2.5 text-sm";
  const update = (index: number, change: Partial<ListedPart>) =>
    setRows((current) => current.map((row, at) => (at === index ? { ...row, ...change } : row)));

  return (
    <div className="mt-4 rounded-control border border-line bg-white/[0.02] p-3">
      <p className="text-sm font-semibold">Price each item for the estimate</p>
      <p className="mt-0.5 text-xs text-ink-muted">What the customer pays for one. Type 0 for no charge.</p>
      <ul className="mt-3 space-y-3">
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
              <label className="text-xs text-ink-muted">
                Unit
                <select value={row.unit} onChange={(event) => update(index, { unit: event.target.value })} className={`${field} mt-1`}>
                  {PART_UNITS.map((unit) => (
                    <option key={unit} value={unit}>
                      {unit}
                    </option>
                  ))}
                </select>
              </label>
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
          </li>
        ))}
      </ul>
      {error ? <p className="mt-2 text-sm text-critical">{error}</p> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await addListedParts(jobNumber, rows);
              if (result.error) setError(result.error);
              else onDone(result.notice ?? "Added to the estimate.");
            })
          }
          className="tap-target inline-flex min-h-12 items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Plus className="h-4 w-4" aria-hidden />}
          Add {rows.length} to the estimate
        </button>
        <button type="button" onClick={onCancel} className="tap-target inline-flex min-h-11 items-center px-3 text-sm font-semibold text-ink-muted">
          Back to the list
        </button>
      </div>
    </div>
  );
}

export function JobMaterialChat({ jobNumber, saved, ai, canConnect, jobDescription, hasLines }: Props) {
  const [list, setList] = useState<MaterialList>(saved.list);
  const [messages, setMessages] = useState<ChatTurn[]>(saved.messages);
  const [draft, setDraft] = useState("");
  const [liveText, setLiveText] = useState<string | null>(null);
  const [pendingPrompt, setPendingPrompt] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [addingTo, setAddingTo] = useState<string | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [chosen, setChosen] = useState<Set<string>>(new Set());
  const [pricing, setPricing] = useState(false);
  const [copied, setCopied] = useState(false);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const writing = liveText !== null;
  const shown = writing ? parseMaterialList(liveText ?? "", "live") : list;
  const items = listItems(list);
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

  // Keep a hand edit, and say so if it did not stick.
  function persist(next: MaterialList) {
    setList(next);
    void inOrder(() => saveMaterialList(jobNumber, next)).then(
      (result) => {
        if (result.error) setError(result.error);
      },
      () => setError("The change could not be saved. Try again."),
    );
  }

  async function send(prompt: string) {
    const text = prompt.trim();
    if (!text || writing) return;
    setError("");
    setNotice("");
    setEditingId(null);
    setAddingTo(null);
    setChoosing(false);
    setPricing(false);
    setPendingPrompt(text);
    setLiveText("");
    setDraft("");
    const controller = new AbortController();
    abort.current = controller;

    try {
      await saving.current;
      const response = await fetch(`/api/jobs/${encodeURIComponent(jobNumber)}/materials-chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt: text }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error || "The list could not be written just now. Try again.");
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let all = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        all += decoder.decode(value, { stream: true });
        const end = all.indexOf(END);
        setLiveText(end >= 0 ? all.slice(0, end) : all);
      }
      const end = all.indexOf(END);
      const result = end >= 0 ? (JSON.parse(all.slice(end + 1)) as { error?: string; list?: MaterialList; messages?: ChatTurn[] }) : null;
      if (!result) throw new Error("The reply stopped before it was finished. Try again.");
      if (result.error || !result.list) throw new Error(result.error || "No list came back. Try again.");
      setList(result.list);
      setMessages(result.messages ?? []);
    } catch (problem) {
      if (controller.signal.aborted) return;
      setError(problem instanceof Error ? problem.message : "The list could not be written just now. Try again.");
      setDraft(text);
    } finally {
      setLiveText(null);
      setPendingPrompt("");
      abort.current = null;
    }
  }

  // Everything before the latest request is history; the latest request sits
  // right above the list that answers it.
  const lastAsked = messages.map((turn) => turn.role).lastIndexOf("user");
  const history = (lastAsked >= 0 ? messages.slice(0, lastAsked) : messages).slice(-6);
  const lastPrompt = lastAsked >= 0 ? messages[lastAsked] : undefined;

  return (
    <details id="materials-chat" className="group scroll-mt-24" open={!listed || !hasLines}>
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
                live={writing}
                editingId={editingId}
                choosing={choosing}
                chosen={chosen}
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
                onSaveItem={(item) => {
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
                items={items.filter((item) => chosen.has(item.id))}
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
                <span className="text-sm">{chosen.size} chosen</span>
                <button
                  type="button"
                  onClick={() => setChosen(chosen.size === items.length ? new Set() : new Set(items.map((item) => item.id)))}
                  className="tap-target inline-flex min-h-11 items-center px-2 text-sm font-semibold text-ink-muted"
                >
                  {chosen.size === items.length ? "Clear" : "Choose all"}
                </button>
                <button
                  type="button"
                  disabled={chosen.size === 0}
                  onClick={() => setPricing(true)}
                  className="tap-target ml-auto inline-flex min-h-11 items-center gap-1.5 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
                >
                  Price {chosen.size || ""} for the estimate
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
                  setEditingId(null);
                  setAddingTo(null);
                  setNotice("");
                  setChoosing(true);
                }}
                className="tap-target inline-flex min-h-11 items-center gap-1.5 rounded-control border border-brand px-3 text-sm font-semibold text-brand"
              >
                <ListChecks className="h-4 w-4" aria-hidden />
                Add items to the estimate
              </button>
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
                onClick={() => {
                  if (!window.confirm("Clear this list and the chat, and start again?")) return;
                  void inOrder(() => clearMaterialList(jobNumber)).then(
                    (result) => {
                      if (result.error) {
                        setError(result.error);
                        return;
                      }
                      setList({ intro: "", title: "", sections: [], closing: "" });
                      setMessages([]);
                    },
                    () => setError("The list could not be cleared. Try again."),
                  );
                }}
                className="tap-target inline-flex min-h-11 items-center gap-1.5 px-2 text-sm font-semibold text-ink-muted"
              >
                <RotateCcw className="h-4 w-4" aria-hidden />
                Start over
              </button>
            </div>
          )
        ) : null}
        {notice ? (
          <p className="mt-2 text-sm text-positive" role="status">
            {notice} Find them under Work &amp; materials below.
          </p>
        ) : null}

        {!choosing ? (
          <form
            className="mt-4"
            onSubmit={(event) => {
              event.preventDefault();
              void send(draft);
            }}
          >
            <label htmlFor={`materials-prompt-${jobNumber}`} className="sr-only">
              {listed ? "Ask for changes" : "Describe the job"}
            </label>
            <div className="flex items-end gap-2 rounded-control border border-line bg-raised p-2 focus-within:border-brand/60">
              <textarea
                id={`materials-prompt-${jobNumber}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
                    event.preventDefault();
                    void send(draft);
                  }
                }}
                rows={listed ? 2 : 4}
                disabled={writing}
                placeholder={
                  listed
                    ? "Ask for changes, e.g. “add a surge protector” or “the run is 50 ft”"
                    : "Describe the job, e.g. “Mini-split install: about 30 ft of surface EMT, 230V 20A circuit, outdoor disconnect, liquidtight whip to the condenser.”"
                }
                className="min-h-12 min-w-0 flex-1 resize-y bg-transparent px-1 py-1 text-base leading-6 outline-none placeholder:text-ink-faint disabled:opacity-60"
              />
              <button
                type="submit"
                disabled={writing || !draft.trim()}
                aria-label={listed ? "Send" : "Write the list"}
                className="tap-target inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-control bg-brand text-on-brand disabled:opacity-50"
              >
                {writing ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden /> : <SendHorizontal className="h-5 w-5" aria-hidden />}
              </button>
            </div>
            {!listed && !draft && jobDescription ? (
              <button
                type="button"
                onClick={() => setDraft(jobDescription)}
                className="tap-target mt-2 inline-flex min-h-10 max-w-full items-center rounded-chip border border-line px-3 text-xs font-semibold text-ink-muted"
              >
                <span className="truncate">Start from the job: “{jobDescription}”</span>
              </button>
            ) : null}
          </form>
        ) : null}
        {error ? <p className="mt-2 text-sm text-critical">{error}</p> : null}

        <p className="mt-2 text-xs text-ink-faint">
          Runs on {ai.label}.
          {!ai.connected && canConnect ? (
            <>
              {" "}
              <Link href="/settings/integrations" className="font-semibold text-brand">
                Connect your ChatGPT key
              </Link>
            </>
          ) : null}
        </p>
      </div>
    </details>
  );
}
