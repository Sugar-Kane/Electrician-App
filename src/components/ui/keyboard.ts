"use client";

import { useEffect, type KeyboardEvent as ReactKeyboardEvent, type RefObject } from "react";

/**
 * Keyboard behaviour shared by the app's menus, drawer and tab bars, so each
 * one works the way a keyboard user expects without carrying its own copy.
 *
 * - A modal (the phone's main menu) takes focus when it opens, keeps Tab and
 *   Shift+Tab inside itself, and hands focus back to whatever opened it.
 * - A menu takes focus on its first item; the arrow keys, Home and End move
 *   between items; Tab leaves it and closes it.
 * - A tab bar moves between tabs with the left and right arrows, Home and End,
 *   choosing the tab it lands on.
 */

const FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "summary",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

/** What Tab can reach inside an element, in order, skipping anything hidden. */
export function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest("[inert]") && element.getClientRects().length > 0,
  );
}

/**
 * While `active`, keep keyboard focus inside `container`: focus moves in when
 * it opens (to `initial`, or the first thing that can take it), Tab wraps at
 * either end, and when it closes focus goes back to `returnTo`.
 */
export function useFocusTrap({
  active,
  container,
  initial,
  returnTo,
}: {
  active: boolean;
  container: RefObject<HTMLElement | null>;
  initial?: RefObject<HTMLElement | null>;
  returnTo?: RefObject<HTMLElement | null>;
}) {
  useEffect(() => {
    if (!active) return;
    const opener = returnTo?.current ?? (document.activeElement as HTMLElement | null);
    const first = initial?.current ?? focusablesIn(container.current)[0];
    first?.focus();

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Tab") return;
      const items = focusablesIn(container.current);
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const firstItem = items[0]!;
      const lastItem = items[items.length - 1]!;
      const current = document.activeElement;
      const inside = current instanceof Node && container.current?.contains(current);
      if (event.shiftKey && (current === firstItem || !inside)) {
        event.preventDefault();
        lastItem.focus();
      } else if (!event.shiftKey && (current === lastItem || !inside)) {
        event.preventDefault();
        firstItem.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      // Back to where the person was, unless they have already moved on.
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [active, container, initial, returnTo]);
}

/** The index the arrow, Home or End key leads to, or null for any other key. */
export function nextIndex(key: string, current: number, count: number, axis: "vertical" | "horizontal"): number | null {
  if (count === 0) return null;
  const forward = axis === "vertical" ? "ArrowDown" : "ArrowRight";
  const back = axis === "vertical" ? "ArrowUp" : "ArrowLeft";
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === forward) return current < 0 ? 0 : (current + 1) % count;
  if (key === back) return current < 0 ? count - 1 : (current - 1 + count) % count;
  return null;
}

/**
 * Left and right arrows, Home and End on a tab bar: focus the tab and choose
 * it, as a tab bar does. Put on the element with role="tablist".
 */
export function onTabListKeyDown(event: ReactKeyboardEvent<HTMLElement>) {
  const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role='tab']"));
  const index = nextIndex(event.key, tabs.indexOf(document.activeElement as HTMLElement), tabs.length, "horizontal");
  if (index === null) return;
  event.preventDefault();
  const tab = tabs[index]!;
  tab.focus();
  tab.click();
}
