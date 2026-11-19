"use client";

import { useState, type ReactNode } from "react";
import { CheckCircle2, Pencil } from "lucide-react";

import { JobNotes } from "@/components/job-notes";

/**
 * The Work card's own part: the visit, photos and notes. Submitting the notes
 * folds all of it into one line saying the work is submitted, so the card
 * stops looking unfinished; Edit work opens it again. Whatever comes after it
 * on the card (Need to come back for more work?) stays open either way.
 *
 * Starts folded when notes were already submitted on an earlier visit to the
 * page.
 */
export function JobWorkDetails({
  jobNumber,
  notes,
  photoCount,
  visit,
  photos,
}: {
  jobNumber: string;
  notes: string;
  photoCount: number;
  /** The visit card (started time, Call, Text). */
  visit: ReactNode;
  /** The before and after photos. */
  photos: ReactNode;
}) {
  const [submitted, setSubmitted] = useState(Boolean(notes.trim()));
  const [savedNotes, setSavedNotes] = useState(notes);

  if (submitted) {
    return (
      <div className="pb-4">
        <div className="rounded-control border border-positive/40 bg-positive/[0.08] p-3" role="status">
          <p className="flex items-center gap-2 text-sm font-semibold text-positive">
            <CheckCircle2 className="h-5 w-5 shrink-0" aria-hidden />
            Work submitted
          </p>
          {savedNotes.trim() ? <p className="mt-1 line-clamp-3 whitespace-pre-line text-sm text-ink-muted">{savedNotes}</p> : null}
          <p className="mt-1 text-xs text-ink-faint">
            {photoCount > 0 ? `${photoCount} ${photoCount === 1 ? "photo" : "photos"} · ` : ""}Notes saved
          </p>
          <button
            type="button"
            onClick={() => setSubmitted(false)}
            className="tap-target mt-1 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
          >
            <Pencil className="h-4 w-4" aria-hidden />
            Edit work
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="pb-4 [&_section]:border-0 [&_section]:bg-transparent [&_section]:p-0">{visit}</div>
      <div className="py-4">{photos}</div>
      <div className="py-4">
        <JobNotes
          jobNumber={jobNumber}
          notes={savedNotes}
          onSubmitted={(text) => {
            setSavedNotes(text);
            setSubmitted(true);
          }}
        />
      </div>
    </>
  );
}
