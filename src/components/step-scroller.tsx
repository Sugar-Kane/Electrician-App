"use client";

import { useEffect } from "react";

/**
 * When a step is finished and the next one becomes current, bring that next
 * step's card to the top of the screen (under the header), so it is read from
 * its title down rather than landing mid-card.
 *
 * Only on a change of step, remembered per job for this browser tab: opening
 * the job or refreshing it never jumps the page.
 */
export function StepScroller({ jobNumber, current }: { jobNumber: string; current: string }) {
  useEffect(() => {
    const key = `volteira:current-step:${jobNumber}`;
    let previous: string | null = null;
    try {
      previous = window.sessionStorage.getItem(key);
      window.sessionStorage.setItem(key, current);
    } catch {
      return;
    }
    if (previous === null || previous === current || !current) return;
    // After anything else that scrolls on the same update (a section opening,
    // the visit card settling), so this is where the page comes to rest.
    const timer = window.setTimeout(() => {
      const card = document.querySelector<HTMLDetailsElement>('[data-step-current="true"]');
      if (!card) return;
      card.open = true;
      card.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [jobNumber, current]);
  return null;
}
