"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { Check } from "lucide-react";

import { PopoverField, usePopoverClose } from "@/components/ui/popover-field";

/**
 * A list of things to choose one of, drawn by the app.
 *
 * Replaces `<select>`, whose open list on a phone is an operating-system panel
 * that no CSS reaches. `accent-color` tinted the selected row and that was the
 * whole of what was available.
 *
 * The keyboard is the part worth being careful about. A native select gives
 * arrow keys, Home and End, type-ahead and screen-reader announcement for
 * nothing, and a custom listbox is exactly where all of that quietly
 * disappears. So this implements the listbox pattern properly:
 * `aria-activedescendant` rather than moving DOM focus between options, which
 * keeps focus in one place and cannot strand it on an option that just
 * unmounted.
 */

export type Choice = {
  value: string;
  label: string;
  /** A second line, for when the label alone is not enough to pick by. */
  description?: string;
  /** Marks an entry the list would not otherwise contain. */
  odd?: boolean;
};

export function SelectField({
  name,
  choices,
  value,
  defaultValue,
  onChange,
  placeholder = "Choose one",
  label,
  icon,
  disabled,
  required,
}: {
  /** Omitted when the caller is controlled and handles posting itself. */
  name?: string;
  choices: readonly Choice[];
  /** Controlled. Leave unset and use `defaultValue` for the ordinary form case. */
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  /** Names the list for a screen reader, e.g. "Status". */
  label: string;
  icon?: ReactNode;
  disabled?: boolean;
  required?: boolean;
}) {
  const [own, setOwn] = useState(defaultValue ?? "");
  const controlled = value !== undefined;
  const current = controlled ? value : own;

  const chosen = choices.find((choice) => choice.value === current);

  function choose(next: string) {
    if (!controlled) setOwn(next);
    onChange?.(next);
  }

  return (
    <PopoverField
      name={name}
      value={current}
      display={chosen?.label ?? current}
      placeholder={placeholder}
      panelLabel={label}
      icon={icon}
      disabled={disabled}
      required={required}
    >
      <Listbox choices={choices} current={current} label={label} onChoose={choose} />
    </PopoverField>
  );
}

/**
 * The open list.
 *
 * Split out so it mounts fresh each time the field opens, which is what makes
 * "start on the current value" work without an effect that has to guess when to
 * re-run.
 */
function Listbox({
  choices,
  current,
  label,
  onChoose,
}: {
  choices: readonly Choice[];
  current: string;
  label: string;
  onChoose: (value: string) => void;
}) {
  const close = usePopoverClose();
  const list = useRef<HTMLUListElement>(null);
  const startAt = Math.max(
    0,
    choices.findIndex((choice) => choice.value === current),
  );
  const [active, setActive] = useState(startAt);

  // Typed letters jump to the next match, the way they always have in a select.
  const typed = useRef({ text: "", at: 0 });

  useEffect(() => {
    list.current?.focus();
  }, []);

  useEffect(() => {
    list.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active]);

  function pick(value: string) {
    onChoose(value);
    close();
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const last = choices.length - 1;

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActive((at) => Math.min(last, at + 1));
        return;
      case "ArrowUp":
        event.preventDefault();
        setActive((at) => Math.max(0, at - 1));
        return;
      case "Home":
        event.preventDefault();
        setActive(0);
        return;
      case "End":
        event.preventDefault();
        setActive(last);
        return;
      case "PageDown":
        event.preventDefault();
        setActive((at) => Math.min(last, at + 10));
        return;
      case "PageUp":
        event.preventDefault();
        setActive((at) => Math.max(0, at - 10));
        return;
      case "Enter":
      case " ":
        event.preventDefault();
        if (choices[active]) pick(choices[active].value);
        return;
      default:
        break;
    }

    if (event.key.length !== 1) return;

    // Letters typed close together search for a prefix; a pause starts again.
    const now = Date.now();
    typed.current.text = now - typed.current.at > 700 ? event.key : typed.current.text + event.key;
    typed.current.at = now;

    const search = typed.current.text.toLowerCase();
    const found = choices.findIndex((choice) => choice.label.toLowerCase().startsWith(search));
    if (found >= 0) setActive(found);
  }

  return (
    <ul
      ref={list}
      role="listbox"
      aria-label={label}
      tabIndex={-1}
      aria-activedescendant={choices[active] ? `option-${active}` : undefined}
      onKeyDown={onKeyDown}
      className="max-h-[16rem] overflow-y-auto outline-none"
    >
      {choices.map((choice, index) => {
        const selected = choice.value === current;

        return (
          <li
            key={choice.value || `blank-${index}`}
            id={`option-${index}`}
            data-index={index}
            role="option"
            aria-selected={selected}
            onClick={() => pick(choice.value)}
            onMouseEnter={() => setActive(index)}
            className={`tap-row flex min-h-11 cursor-pointer items-center gap-2 rounded-chip px-3 py-2 text-sm ${
              index === active ? "bg-white/[0.08]" : ""
            } ${selected ? "font-semibold text-brand" : "text-ink"}`}
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate">
                {choice.label}
                {choice.odd ? (
                  <span className="ml-1 text-[11px] font-normal text-ink-faint">· saved</span>
                ) : null}
              </span>
              {choice.description ? (
                <span className="block truncate text-[11px] text-ink-muted">
                  {choice.description}
                </span>
              ) : null}
            </span>
            {selected ? <Check className="h-4 w-4 shrink-0" aria-hidden /> : null}
          </li>
        );
      })}
    </ul>
  );
}
