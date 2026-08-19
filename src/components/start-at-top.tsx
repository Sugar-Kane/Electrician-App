"use client";

import { useEffect } from "react";

import { scrollToTop } from "@/lib/scroll-top";

/**
 * The screen this sits on always opens at the top.
 *
 * Home is read from the first line down — the greeting, what needs attention,
 * today's jobs — and arriving halfway through it is arriving in the middle of a
 * sentence. Next restores the scroll position when you come back to a page it
 * has cached, which is the right default for a long list you were reading and
 * the wrong one for a dashboard you came back to for the summary.
 *
 * On mount only. Scrolling the user back up while they are reading would be
 * worse than the problem.
 */
export function StartAtTop() {
  useEffect(() => {
    scrollToTop();
  }, []);

  return null;
}
