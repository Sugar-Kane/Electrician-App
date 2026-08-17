"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown } from "lucide-react";

import { inputClass } from "@/components/ui/field";

/**
 * A field that opens something the app drew itself.
 *
 * The reason this exists at all: iOS draws its own panel for `<input
 * type="date">`, `type="time"` and `<select>`, and nothing on the page reaches
 * inside it. `color-scheme: dark` and `accent-color` in `globals.css` are the
 * end of what CSS can do, and a system-blue calendar sitting on top of a yellow
 * and near-black app is what is left over. The only way to theme these is to
 * stop using the native control.
 *
 * The panel expands in place, below the field, pushing the form down. Not a
 * portal and not an overlay: these fields sit three panels deep inside a card,
 * and an absolutely positioned popover would have to out-argue every
 * `overflow` and stacking context between here and the page. Expanding in flow
 * cannot be clipped by anything, and it is the same disclosure the electrician
 * cards already use, so it is not a new idea to learn either.
 */

/**
 * Close on a click outside, and on Escape.
 *
 * Escape also puts focus back on the trigger. Without that the focus ring is
 * left on an element that has just been unmounted and the next Tab starts from
 * the top of the document — which on a form three panels deep means starting
 * the page again.
 */
export function useDismissable({
  open,
  onClose,
  root,
  trigger,
}: {
  open: boolean;
  onClose: () => void;
  root: RefObject<HTMLElement | null>;
  trigger?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) onClose();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      onClose();
      trigger?.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose, root, trigger]);
}

/**
 * How the panel's contents close it.
 *
 * A context rather than a render prop taking a callback. The render prop was
 * the obvious shape and it is the wrong one: it is invoked during render, so
 * every function handed through it counts as being called during render, and
 * `close` has to read the trigger ref to put focus back. Passing it down here
 * instead means it is only ever called from an event.
 */
const PopoverContext = createContext<{ close: () => void } | null>(null);

/** Closes the field this is rendered inside, and returns focus to it. */
export function usePopoverClose(): () => void {
  const context = useContext(PopoverContext);
  if (!context) throw new Error("usePopoverClose must be used inside a PopoverField");
  return context.close;
}

export function PopoverField({
  name,
  value,
  display,
  placeholder,
  icon,
  disabled,
  required,
  panelLabel,
  haspopup = "listbox",
  children,
}: {
  /** Omitted when the caller is controlled and posts nothing itself. */
  name?: string;
  value: string;
  /** What the trigger reads when there is a value. */
  display: string;
  placeholder: string;
  icon?: ReactNode;
  disabled?: boolean;
  required?: boolean;
  /** Names the panel for a screen reader, e.g. "Choose a date". */
  panelLabel: string;
  haspopup?: "listbox" | "dialog";
  /**
   * The panel. Owns its own keyboard handling — a grid and a list do not move
   * the same way — and calls `usePopoverClose()` when something is chosen.
   */
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const panelId = useId();

  const dismiss = useCallback(() => setOpen(false), []);

  /*
   * Choosing something closes the panel and puts focus back on the field.
   *
   * Separate from `dismiss`, which is what a click outside runs: clicking
   * somewhere else on the page and having focus yanked back here would be the
   * control fighting for attention it was not given.
   */
  const close = useCallback(() => {
    setOpen(false);
    trigger.current?.focus();
  }, []);

  const panelApi = useMemo(() => ({ close }), [close]);

  useDismissable({ open, onClose: dismiss, root, trigger });

  useEffect(() => {
    if (!open) return;
    // Opened near the bottom of a long form, the panel would otherwise expand
    // off the screen and look like nothing happened.
    panel.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);

  return (
    <div ref={root} className="relative">
      {/*
        The value travels in a hidden input, so every form this replaces a
        native control in keeps posting exactly what it posted before and no
        server action has to know this changed.
      */}
      {name ? <input type="hidden" name={name} value={value} required={required} /> : null}

      <button
        ref={trigger}
        type="button"
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          // Down opens without choosing anything, which is how a native select
          // has always behaved and the first thing a keyboard user tries.
          if (event.key === "ArrowDown" && !open) {
            event.preventDefault();
            setOpen(true);
          }
        }}
        aria-haspopup={haspopup}
        aria-expanded={open}
        aria-controls={open ? panelId : undefined}
        className={`${inputClass} tap-target flex items-center gap-2 text-left disabled:opacity-60`}
      >
        {icon ? <span className="shrink-0 text-ink-faint">{icon}</span> : null}
        <span className={`min-w-0 flex-1 truncate ${value ? "" : "text-ink-faint"}`}>
          {value ? display : placeholder}
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
          aria-hidden
        />
      </button>

      {open ? (
        <div
          ref={panel}
          id={panelId}
          aria-label={panelLabel}
          className="mt-2 overflow-hidden rounded-control border border-line bg-sunken p-2 shadow-2xl shadow-black/40"
        >
          <PopoverContext.Provider value={panelApi}>{children}</PopoverContext.Provider>
        </div>
      ) : null}
    </div>
  );
}
