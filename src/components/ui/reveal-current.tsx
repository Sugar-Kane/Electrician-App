"use client";

import { useEffect } from "react";

/**
 * Scrolls a sideways-scrolling row of links so the current one is in view.
 *
 * On a phone the jobs filters scroll inside their own row, and arriving at
 * "Completed" or "Time passed" from a link left the selected chip off the
 * right edge, so nothing on screen said which list this was. Only the row
 * moves; the page stays where it is.
 */
export function RevealCurrent({ targetId }: { targetId: string }) {
  useEffect(() => {
    const row = document.getElementById(targetId);
    const current = row?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!row || !current) return;
    const rowBox = row.getBoundingClientRect();
    const box = current.getBoundingClientRect();
    if (box.left >= rowBox.left && box.right <= rowBox.right) return;
    row.scrollLeft += box.left - rowBox.left - 12;
  }, [targetId]);

  return null;
}
