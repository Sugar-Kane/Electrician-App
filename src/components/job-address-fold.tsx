"use client";

import { useCallback, useRef } from "react";
import { MapPin } from "lucide-react";

import { JobPlace, type JobPlaceDetails } from "@/components/job-controls";

/**
 * The service address in the Schedule step: one line with Change once it is
 * saved, open while there is none, and folded again after a save.
 */
export function JobAddressFold({
  jobNumber,
  place,
  label,
}: {
  jobNumber: string;
  place: JobPlaceDetails | null;
  /** The street as saved, e.g. "335 Kestrel Way"; "" when there is none. */
  label: string;
}) {
  const fold = useRef<HTMLDetailsElement>(null);
  const close = useCallback(() => {
    if (fold.current) fold.current.open = false;
  }, []);

  return (
    <details ref={fold} className="group/address mt-3" open={!label}>
      <summary className="tap-target flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-control border border-line bg-raised px-4 py-2 [&::-webkit-details-marker]:hidden">
        <span className="flex min-w-0 items-center gap-2.5 text-sm">
          <MapPin className="h-5 w-5 shrink-0 text-brand" aria-hidden />
          <span className="truncate font-semibold">{label || "No service address yet"}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-brand/15 px-3 py-1.5 text-sm font-semibold text-brand">
          <span className="group-open/address:hidden">{label ? "Change" : "Add"}</span>
          <span className="hidden group-open/address:inline">Close</span>
        </span>
      </summary>
      <div className="mt-3 [&_section]:border-0 [&_section]:bg-transparent [&_section]:p-0">
        <JobPlace jobNumber={jobNumber} place={place} onSaved={close} />
      </div>
    </details>
  );
}
