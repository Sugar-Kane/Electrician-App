"use client";

import { useEffect } from "react";
import Link from "next/link";
import { RotateCw, TriangleAlert } from "lucide-react";

/**
 * What a page failing looks like to somebody standing in a customer's house.
 *
 * There was no boundary at all, so anything thrown during a render reached the
 * screen as the framework's own words — "This page couldn't load", or worse, a
 * stack. That is what a technician saw after taking a photo the app could not
 * accept, and it tells them nothing they can act on: not what failed, not
 * whether their work was saved, not what to press.
 *
 * The real error still needs reading, so it goes to the console and the
 * platform's logs with its digest. What the electrician gets is a sentence and
 * two buttons.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("page failed to render", error);
  }, [error]);

  return (
    <main className="grid min-h-screen place-items-center bg-canvas p-6 text-ink">
      <div className="w-full max-w-md rounded-panel border border-line bg-surface p-6 text-center">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-chip bg-caution-bg text-caution">
          <TriangleAlert className="h-6 w-6" aria-hidden />
        </span>

        <h1 className="mt-4 text-lg font-semibold">Something went wrong loading this</h1>
        <p className="mt-2 text-sm leading-6 text-ink-muted">
          Your work is saved. Try again, and if it keeps happening carry on from the schedule —
          nothing here blocks the job.
        </p>

        <div className="mt-5 grid gap-2">
          <button
            type="button"
            onClick={reset}
            className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 text-sm font-bold text-on-brand"
          >
            <RotateCw className="h-4 w-4" aria-hidden />
            Try again
          </button>
          <Link
            href="/schedule"
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-5 text-sm font-semibold"
          >
            Back to jobs
          </Link>
        </div>

        {/* The one technical detail worth showing: it is what support would ask
            for, and it is meaningless to anybody who does not need it. */}
        {error.digest ? (
          <p className="mt-4 text-[11px] text-ink-faint">Reference {error.digest}</p>
        ) : null}
      </div>
    </main>
  );
}
