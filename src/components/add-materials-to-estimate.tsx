"use client";

import { ListChecks } from "lucide-react";

/**
 * On the Estimate card: opens the materials list above with its items to
 * tick, and the ticked ones are priced onto the estimate.
 */
export function AddMaterialsToEstimate({ count, label = "Add materials to estimate" }: { count: number; label?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event("volteira:choose-materials"))}
      className="tap-target mb-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-brand bg-brand/[0.08] px-4 text-sm font-semibold text-brand"
    >
      <ListChecks className="h-4 w-4" aria-hidden />
      {label}
      <span className="font-normal text-ink-muted">· {count} on the list</span>
    </button>
  );
}
