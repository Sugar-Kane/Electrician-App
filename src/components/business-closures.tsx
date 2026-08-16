"use client";

import { useState } from "react";
import { Store } from "lucide-react";

import { BlackoutManager } from "@/components/blackout-manager";
import type { TechnicianBlackout } from "@/lib/job-data";

/**
 * Days the whole business is shut.
 *
 * Above the crew rather than inside it, because it is not a property of any one
 * electrician — it outranks all of them. A closure blocks the slot before
 * anybody's availability is counted, so hiring somebody in November cannot
 * accidentally reopen Christmas.
 */

export function BusinessClosures({ closures }: { closures: TechnicianBlackout[] }) {
  const [open, setOpen] = useState(false);

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="tap-target flex w-full items-center gap-3 text-left"
      >
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-caution-bg">
          <Store className="h-5 w-5 text-caution" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-base font-semibold">Business closed</span>
          <span className="block truncate text-xs text-ink-muted">
            {closures.length === 0
              ? "Public holidays and shutdowns — nobody is bookable"
              : `${closures.length} ${closures.length === 1 ? "closure" : "closures"} booked`}
          </span>
        </span>
        <span className="shrink-0 text-xs font-semibold text-brand">{open ? "Hide" : "Open"}</span>
      </button>

      {open ? (
        <div className="mt-3">
          <BlackoutManager
            blackouts={closures}
            emptyText="The business is open on every working day."
            addLabel="Close the business"
          />
        </div>
      ) : null}
    </section>
  );
}
