"use client";

import { useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, MapPin } from "lucide-react";

import { resolveAddress, suggestAddresses } from "@/app/address-actions";
import { Field, TextInput, inputClass } from "@/components/ui/field";
import { shouldSearch, type AddressParts, type AddressSuggestion } from "@/lib/address-search";

/**
 * Where the work is, as four boxes that fill themselves.
 *
 * All four are here rather than in the form because picking a suggestion sets
 * all four at once, and four uncontrolled inputs cannot be set from outside
 * without reaching into the DOM. They still post under the same names, so no
 * server action knows this changed.
 *
 * Typing the whole thing by hand still works. The suggestions are an offer, not
 * a gate — plenty of the addresses this business drives to are a gate off a
 * county road that Google has never heard of.
 */

const DEBOUNCE_MS = 300;

export type AddressDefaults = Partial<AddressParts>;

export function AddressFields({ defaults }: { defaults?: AddressDefaults }) {
  const [parts, setParts] = useState<AddressParts>({
    line1: defaults?.line1 ?? "",
    city: defaults?.city ?? "",
    state: defaults?.state ?? "",
    postalCode: defaults?.postalCode ?? "",
  });

  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [active, setActive] = useState(-1);

  /*
   * Whether the list is on screen is worked out at render rather than kept in
   * state. Deleting back to two characters hides it without an effect having
   * to notice and clear anything.
   */
  const showing = open && shouldSearch(parts.line1) && suggestions.length > 0;

  const root = useRef<HTMLDivElement>(null);
  const listId = useId();

  /*
   * One billed session covers the typing plus the single lookup that follows.
   * A new one starts after each resolved address, which is what Google's
   * pricing means by a session.
   */
  const session = useRef("");
  function sessionToken(): string {
    if (!session.current) {
      session.current =
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : String(Date.now());
    }
    return session.current;
  }

  /*
   * Which request is the current one.
   *
   * Two keystrokes in flight can come back in either order, and the slower one
   * arriving last would leave the list showing matches for a prefix the person
   * has already typed past.
   */
  const asked = useRef(0);

  /** True while a suggestion is being applied, so it does not re-search. */
  const applying = useRef(false);

  useEffect(() => {
    if (applying.current) {
      applying.current = false;
      return;
    }

    // Bumped before the early return as well, so a reply to a query somebody
    // has already deleted past cannot arrive and repopulate the list.
    const mine = asked.current + 1;
    asked.current = mine;

    const query = parts.line1;
    if (!shouldSearch(query)) return;

    const timer = setTimeout(async () => {
      setBusy(true);
      const result = await suggestAddresses({ query, sessionToken: sessionToken() });
      setBusy(false);
      if (asked.current !== mine) return;

      setSuggestions(result.suggestions);
      setActive(-1);
      setOpen(result.suggestions.length > 0);
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [parts.line1]);

  useEffect(() => {
    if (!showing) return;

    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [showing]);

  async function choose(suggestion: AddressSuggestion) {
    setOpen(false);
    setSuggestions([]);
    setBusy(true);

    const result = await resolveAddress({
      placeId: suggestion.id,
      sessionToken: sessionToken(),
    });
    setBusy(false);

    // The session is spent either way — Google counts the lookup, not the
    // outcome — so it starts again from here.
    session.current = "";

    if (!result.parts || !result.parts.line1) {
      /*
       * The lookup failed or came back without a street. Keep what was tapped
       * rather than clearing the box: the primary text is the street, which is
       * more than the person had typed, and the other three are still theirs to
       * fill in.
       */
      applying.current = true;
      setParts((current) => ({ ...current, line1: suggestion.primary }));
      return;
    }

    applying.current = true;
    setParts(result.parts);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (!showing) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((at) => Math.min(suggestions.length - 1, at + 1));
      return;
    }
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
      // Enter on a highlighted suggestion picks it. Without the preventDefault
      // it would submit the form instead, which on this screen creates the job.
      event.preventDefault();
      const picked = suggestions[active];
      if (picked) void choose(picked);
    }
  }

  function set(key: keyof AddressParts, value: string) {
    setParts((current) => ({ ...current, [key]: value }));
  }

  return (
    <>
      <div className="sm:col-span-2" ref={root}>
        <Field
          label="Street address"
          hint="Start typing and pick the address — the town, state and ZIP fill themselves in."
          group
        >
          <div className="relative">
            <input
              name="addressLine1"
              value={parts.line1}
              onChange={(event) => set("line1", event.target.value)}
              onKeyDown={onKeyDown}
              onFocus={() => setOpen(suggestions.length > 0)}
              // Off, deliberately. The browser's own address list and this one
              // would otherwise cover each other up.
              autoComplete="off"
              role="combobox"
              aria-expanded={showing}
              aria-controls={showing ? listId : undefined}
              aria-autocomplete="list"
              aria-activedescendant={
                showing && active >= 0 ? `${listId}-option-${active}` : undefined
              }
              aria-label="Street address"
              placeholder="123 Main St"
              className={`${inputClass} pr-10`}
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 grid place-items-center text-ink-faint">
              {busy ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <MapPin className="h-4 w-4" aria-hidden />
              )}
            </span>

            {showing ? (
              <ul
                id={listId}
                role="listbox"
                aria-label="Address suggestions"
                className="absolute left-0 right-0 top-full z-20 mt-2 overflow-hidden rounded-control border border-line bg-sunken p-2 shadow-2xl shadow-black/40"
              >
                {suggestions.map((suggestion, index) => (
                  <li
                    key={suggestion.id}
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={index === active}
                    onMouseEnter={() => setActive(index)}
                    /*
                     * `mousedown`, not `click`. The input loses focus first on a
                     * tap, and the outside-click handler would close the list
                     * out from under the finger.
                     */
                    onMouseDown={(event) => {
                      event.preventDefault();
                      void choose(suggestion);
                    }}
                    className={`tap-row flex min-h-11 cursor-pointer flex-col justify-center rounded-chip px-3 py-2 text-sm ${
                      index === active ? "bg-white/[0.08]" : ""
                    }`}
                  >
                    <span className="block truncate text-ink">{suggestion.primary}</span>
                    {suggestion.secondary ? (
                      <span className="block truncate text-[11px] text-ink-muted">
                        {suggestion.secondary}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </Field>
      </div>

      <Field label="City">
        <TextInput
          name="city"
          value={parts.city}
          onChange={(event) => set("city", event.target.value)}
          autoComplete="off"
          placeholder="Nipomo"
        />
      </Field>
      <Field label="State">
        <TextInput
          name="state"
          value={parts.state}
          onChange={(event) => set("state", event.target.value.toUpperCase())}
          autoComplete="off"
          placeholder="CA"
          maxLength={2}
        />
      </Field>
      <Field
        label="ZIP"
        hint="Leave the whole address blank if it is not known yet — it can be added later. A job with no address will not appear on the map."
      >
        <TextInput
          name="postalCode"
          value={parts.postalCode}
          onChange={(event) => set("postalCode", event.target.value)}
          inputMode="numeric"
          autoComplete="postal-code"
          maxLength={10}
          placeholder="93444"
        />
      </Field>
    </>
  );
}
