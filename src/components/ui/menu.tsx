"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * Every dropdown in the app, behaving the same way.
 *
 * There was exactly one dropdown before this — the account menu — carrying its
 * own outside-click and Escape handling, and everything else was a native
 * `<select>`. So there was no pattern to be consistent with: menus opened
 * differently, closed differently, and only one of them could be operated from
 * a keyboard at all.
 *
 * What "the same" means here:
 *  - click the trigger to open, click it again to close
 *  - Escape closes and returns focus to the trigger, so the keyboard does not
 *    get stranded inside a menu that is no longer visible
 *  - a click anywhere outside closes
 *  - choosing anything closes
 *  - the trigger reports its state to assistive technology
 *
 * Rendered inline rather than in a portal. Every menu in this app hangs off a
 * header or a row that is already above the page, and a portal would buy
 * z-index correctness at the cost of losing the scroll container.
 */

export function Menu({
  trigger,
  children,
  align = "right",
  label,
}: {
  /** The button's contents. The button itself is supplied here. */
  trigger: ReactNode;
  children: ReactNode;
  align?: "left" | "right";
  /** Describes the menu for screen readers, e.g. "Account menu". */
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setOpen(false);
      // Without this the focus ring is left on an element that has just been
      // unmounted, and the next Tab starts from the top of the document.
      triggerRef.current?.focus();
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        className="tap-target flex items-center rounded-control border border-line bg-raised px-1.5 text-ink transition hover:border-line-strong"
      >
        {trigger}
      </button>

      {open ? (
        <div
          id={menuId}
          role="menu"
          aria-label={label}
          onClick={() => setOpen(false)}
          className={`absolute top-[calc(100%+8px)] z-[65] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-control border border-line bg-sunken p-2 shadow-2xl shadow-black/40 ${
            align === "right" ? "right-0" : "left-0"
          }`}
        >
          {children}
        </div>
      ) : null}
    </div>
  );
}

/** A row inside a menu. Consistent height, so a menu is not a ragged list. */
export function MenuItem({
  children,
  icon,
  description,
}: {
  children: ReactNode;
  icon?: ReactNode;
  description?: string;
}) {
  return (
    <span className="tap-row flex min-h-14 items-center gap-3 rounded-chip px-3 py-2 hover:bg-white/[0.06]">
      {icon ? (
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-chip bg-brand/10 text-brand">
          {icon}
        </span>
      ) : null}
      <span className="min-w-0">
        <span className="block text-sm font-semibold text-ink">{children}</span>
        {description ? (
          <span className="block text-[11px] text-ink-muted">{description}</span>
        ) : null}
      </span>
    </span>
  );
}

/** A rule between groups of menu items. */
export function MenuSeparator() {
  return <div className="my-2 border-t border-line" />;
}
