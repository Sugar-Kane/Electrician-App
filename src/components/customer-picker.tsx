"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Search, UserRoundCheck } from "lucide-react";

import { Field, inputClass } from "@/components/ui/field";
import { choiceDetail, findCustomerChoices, type CustomerChoice } from "@/lib/customer-choices";

/**
 * Somebody the business already has, picked instead of typed.
 *
 * Opens on the people seen most recently, so the common case — booking the
 * customer from last week again — is a tap with nothing typed. Typing narrows
 * it the way Search does: a name, a phone number however it is written, an
 * email, a street.
 *
 * Picking fills the boxes below rather than replacing them, so a new mobile
 * number or a second address is still typed over the top. Saving keeps them
 * one customer either way: a customer is matched on their number, or on their
 * email when they have none, and an address on its street and unit.
 */
export function CustomerPicker({
  choices,
  picked,
  onPick,
  onClear,
}: {
  choices: CustomerChoice[];
  /** The customer whose details are in the boxes below, when one was picked. */
  picked: CustomerChoice | null;
  onPick: (choice: CustomerChoice) => void;
  onClear: () => void;
}) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  const found = findCustomerChoices(choices, query, 6);
  const showing = open && found.length > 0;

  useEffect(() => {
    if (!showing) return;

    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showing]);

  function choose(choice: CustomerChoice) {
    onPick(choice);
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
      // Without this Enter would submit the form, which here creates the job.
      event.preventDefault();
      const choice = found[active];
      if (choice) choose(choice);
    }
  }

  return (
    <div className="sm:col-span-2" ref={root}>
      <Field
        label="Returning customer"
        // Not while the list is open: it sits under the list, and its first
        // line showed through the gap between the box and the list.
        hint={
          picked || showing
            ? undefined
            : "Pick someone who has booked before and their details fill in below. New customers are typed in as usual."
        }
        group
      >
        <div className="relative">
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
            onKeyDown={onKeyDown}
            // Not posted. The boxes below are what is saved.
            autoComplete="off"
            role="combobox"
            aria-expanded={showing}
            aria-controls={showing ? listId : undefined}
            aria-autocomplete="list"
            aria-activedescendant={showing && active >= 0 ? `${listId}-option-${active}` : undefined}
            aria-label="Find a returning customer"
            placeholder="Search by name, phone or street"
            className={`${inputClass} pl-11`}
          />

          {showing ? (
            <ul
              id={listId}
              role="listbox"
              aria-label={query.trim() ? "Matching customers" : "Recent customers"}
              className="absolute left-0 right-0 top-full z-20 mt-2 max-h-80 overflow-y-auto rounded-control border border-line bg-sunken p-2 shadow-2xl shadow-black/40"
            >
              {query.trim() ? null : (
                <li
                  role="presentation"
                  className="px-3 pb-1 pt-0.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-ink-faint"
                >
                  Recent
                </li>
              )}
              {found.map((choice, index) => (
                <li
                  key={choice.key}
                  id={`${listId}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseEnter={() => setActive(index)}
                  // `mousedown`, not `click`: the input blurs first on a tap,
                  // and the outside-click handler would close the list under
                  // the finger.
                  onMouseDown={(event) => {
                    event.preventDefault();
                    choose(choice);
                  }}
                  className={`tap-row flex min-h-12 cursor-pointer flex-col justify-center rounded-chip px-3 py-2 ${
                    index === active ? "bg-white/[0.08]" : ""
                  }`}
                >
                  <span className="block truncate text-sm font-semibold text-ink">{choice.name}</span>
                  <span className="block truncate text-xs text-ink-muted">{choiceDetail(choice)}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </Field>

      {picked ? (
        <p className="mt-2 flex items-center gap-2 text-sm text-ink-muted">
          <UserRoundCheck className="h-4 w-4 shrink-0 text-positive" aria-hidden />
          <span className="min-w-0 flex-1">
            <span className="font-semibold text-ink">{picked.name}</span> — filled in below, and kept with
            their past jobs.
          </span>
          <button
            type="button"
            onClick={onClear}
            className="tap-target inline-flex min-h-11 shrink-0 items-center px-2 text-sm font-semibold text-brand"
          >
            Clear
          </button>
        </p>
      ) : null}
    </div>
  );
}
