"use client";

import { useEffect, useId, useRef, useState } from "react";
import { PackageCheck, Search } from "lucide-react";

import { inputClass } from "@/components/ui/field";
import { findStockChoices, stockChoiceDetail, type StockChoice } from "@/lib/stock-choices";

/**
 * A part off the shelf, found rather than scrolled to.
 *
 * This replaced a dropdown labelled "From stock" whose resting state read "Not
 * from stock" — which was true and told nobody that the van's whole inventory
 * was one tap away. It also had no search, so a long stock list was a long
 * scroll with a thumb.
 *
 * Tapping the box shows the whole shelf; typing narrows it by name, part number
 * or bin, searched the way the Stock page searches. Picking fills the part
 * below, and saving takes it off the count. Not picking is the other way in:
 * the boxes below take anything typed, and a part typed by hand touches no
 * stock.
 */
export function StockPicker<T extends StockChoice>({
  stock,
  picked,
  onPick,
  onClear,
  hint = "Pick a part you stock and it fills in below, and comes off the count when added. Anything else, type below.",
}: {
  stock: readonly T[];
  /** The stock item the part below came from, when one was picked. */
  picked: T | null;
  onPick: (item: T) => void;
  onClear: () => void;
  /** What picking does, said under the box until something is picked. */
  hint?: string;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const found = findStockChoices(stock, query);
  const showing = open && found.length > 0;
  const nothing = open && query.trim() !== "" && found.length === 0;

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  function choose(item: T) {
    onPick(item);
    setQuery("");
    setOpen(false);
    setActive(-1);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((at) => Math.min(found.length - 1, at + 1));
      return;
    }
    if (!showing) return;
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((at) => Math.max(0, at - 1));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "Enter" && active >= 0) {
      // Without this Enter would submit the form, which adds the line.
      event.preventDefault();
      const item = found[active];
      if (item) choose(item);
    }
  }

  return (
    <div ref={root}>
      <span className="text-xs font-semibold text-ink-muted">From inventory</span>
      <div className="relative mt-1">
        <span className="pointer-events-none absolute inset-y-0 left-4 grid place-items-center text-ink-faint">
          <Search className="h-4 w-4" aria-hidden />
        </span>
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          // A tap on the box once it already has focus — after a pick, or
          // after Escape — fires no focus, and would otherwise open nothing.
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          // Not posted. The part below is what is saved.
          autoComplete="off"
          role="combobox"
          aria-expanded={showing}
          aria-controls={showing ? listId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={showing && active >= 0 ? `${listId}-option-${active}` : undefined}
          aria-label="Search inventory"
          placeholder="Search name, part number or bin"
          className={`${inputClass} pl-11`}
        />

        {showing ? (
          <ul
            id={listId}
            role="listbox"
            aria-label={query.trim() ? "Matching parts" : "Inventory"}
            className="absolute left-0 right-0 top-full z-20 mt-2 max-h-72 overflow-y-auto rounded-control border border-line bg-sunken p-2 shadow-2xl shadow-black/40"
          >
            {found.map((item, index) => (
              <li
                key={item.id}
                id={`${listId}-option-${index}`}
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                // `mousedown`, not `click`: the input blurs first on a tap, and
                // the outside-click handler would close the list under the finger.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(item);
                }}
                className={`tap-row flex min-h-12 cursor-pointer flex-col justify-center rounded-chip px-3 py-2 ${
                  index === active ? "bg-white/[0.08]" : ""
                }`}
              >
                {/* Wrapped, not cut to one line. What tells two parts apart is
                    usually at the end of the name — single-pole or double,
                    white or almond — which is the end an ellipsis takes. */}
                <span className="block break-words text-sm font-semibold text-ink">{item.name}</span>
                <span
                  className={`block break-words text-xs ${item.quantityOnHand > 0 ? "text-ink-muted" : "text-caution"}`}
                >
                  {stockChoiceDetail(item)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {nothing ? (
        <p className="mt-1.5 text-xs leading-5 text-ink-muted" role="status">
          Nothing in inventory matches “{query.trim()}”. Type the part below instead.
        </p>
      ) : picked ? (
        <p className="mt-1.5 flex items-center gap-2 text-xs leading-5 text-ink-muted">
          <PackageCheck className="h-4 w-4 shrink-0 text-positive" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-ink">From inventory</span> · {stockChoiceDetail(picked)}
          </span>
          <button
            type="button"
            onClick={onClear}
            className="tap-target inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-brand"
          >
            Clear
          </button>
        </p>
      ) : showing ? null : (
        <p className="mt-1.5 text-xs leading-5 text-ink-muted">{hint}</p>
      )}
    </div>
  );
}
