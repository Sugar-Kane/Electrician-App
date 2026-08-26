"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  Eye,
  EyeOff,
  ExternalLink,
  LoaderCircle,
  PenLine,
  Sparkles,
  Undo2,
} from "lucide-react";

import {
  askAssistantToEdit,
  setPostVisibility,
  undoLastEdit,
  writePostNow,
  type JournalActionState,
} from "@/app/settings/journal/actions";
import { FormMessage } from "@/components/ui/field";
import type { OwnerPost, WritableJob } from "@/lib/journal-admin";

/**
 * The journal, from the business's side.
 *
 * Three things a post can need and nothing else: reading it, taking it down,
 * and asking for a change. There is no rich text editor, and that is a
 * decision rather than an omission — a post is written by the assistant and
 * changed by asking, so a box full of formatting buttons would be offering a
 * second way to do the same job badly on a phone.
 *
 * Declined jobs are shown rather than hidden. The row that says "nothing was
 * written down about this one" is the most useful thing on the screen: it is
 * the one that tells somebody why finishing a job did not produce a post.
 */

const initialState: JournalActionState = { error: "" };

function when(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

function StatusChip({ post }: { post: OwnerPost }) {
  if (post.status === "declined") {
    return (
      <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-semibold text-ink-faint">
        no post
      </span>
    );
  }
  if (post.status === "hidden") {
    return (
      <span className="shrink-0 rounded-full bg-caution/15 px-2 py-0.5 text-[10px] font-semibold text-caution">
        hidden
      </span>
    );
  }
  return (
    <span className="shrink-0 rounded-full bg-positive/15 px-2 py-0.5 text-[10px] font-semibold text-positive">
      live
    </span>
  );
}

function PostRow({ post, publicHref }: { post: OwnerPost; publicHref: string }) {
  const [open, setOpen] = useState(false);
  const [visibility, visibilityAction, hiding] = useActionState(setPostVisibility, initialState);
  const [edit, editAction, editing] = useActionState(askAssistantToEdit, initialState);
  const [undo, undoAction, undoing] = useActionState(undoLastEdit, initialState);

  const declined = post.status === "declined";

  return (
    <li className="rounded-panel border border-line bg-surface p-3 sm:p-4">
      <div className="flex items-start gap-3">
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2">
            <StatusChip post={post} />
            <span className="truncate text-[11px] text-ink-faint">
              {[post.jobNumber ? `job ${post.jobNumber}` : "", post.town, when(post.createdAt)]
                .filter(Boolean)
                .join(" · ")}
            </span>
          </span>
          <span className="mt-1 block text-sm font-semibold leading-snug text-ink">
            {declined ? "No post was written" : post.title}
          </span>
          <span className="mt-0.5 block text-xs leading-5 text-ink-muted">
            {declined ? post.declineReason : post.dek}
          </span>
        </span>
      </div>

      {declined ? (
        <p className="mt-3 rounded-control border border-line bg-raised p-2.5 text-[11px] leading-4 text-ink-muted">
          Posts are written from what is on the job. Add what you did in the technician notes and
          this can be written up.
        </p>
      ) : (
        <>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setOpen(!open)}
              aria-expanded={open}
              className="tap-target inline-flex items-center gap-1.5 rounded-control border border-line px-3 text-xs font-semibold text-ink"
            >
              <PenLine className="h-3.5 w-3.5" aria-hidden />
              Ask for a change
            </button>

            <form action={visibilityAction}>
              <input type="hidden" name="postId" value={post.id} />
              <input type="hidden" name="hide" value={post.status === "published" ? "true" : "false"} />
              <button
                type="submit"
                disabled={hiding}
                className="tap-target inline-flex items-center gap-1.5 rounded-control border border-line px-3 text-xs font-semibold text-ink disabled:opacity-60"
              >
                {hiding ? (
                  <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : post.status === "published" ? (
                  <EyeOff className="h-3.5 w-3.5" aria-hidden />
                ) : (
                  <Eye className="h-3.5 w-3.5" aria-hidden />
                )}
                {post.status === "published" ? "Take it down" : "Put it back"}
              </button>
            </form>

            {post.status === "published" && publicHref ? (
              <Link
                href={`${publicHref}/${post.slug}`}
                target="_blank"
                rel="noreferrer"
                className="tap-target inline-flex items-center gap-1.5 rounded-control border border-line px-3 text-xs font-semibold text-ink-muted"
              >
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
                View
              </Link>
            ) : null}

            {post.revisionCount > 0 ? (
              <form action={undoAction}>
                <input type="hidden" name="postId" value={post.id} />
                <button
                  type="submit"
                  disabled={undoing}
                  className="tap-target inline-flex items-center gap-1.5 rounded-control border border-line px-3 text-xs font-semibold text-ink-muted disabled:opacity-60"
                >
                  {undoing ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Undo2 className="h-3.5 w-3.5" aria-hidden />
                  )}
                  Undo last change
                </button>
              </form>
            ) : null}
          </div>

          {open ? (
            <form action={editAction} className="mt-3 rounded-control border border-line bg-raised p-3">
              <input type="hidden" name="postId" value={post.id} />
              <label htmlFor={`instruction-${post.id}`} className="block text-xs font-semibold text-ink">
                What would you like changed?
              </label>
              <textarea
                id={`instruction-${post.id}`}
                name="instruction"
                rows={3}
                maxLength={1000}
                placeholder="Make the second paragraph shorter, and say we are licensed and insured."
                className="mt-2 w-full rounded-control border border-line bg-surface p-2.5 text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="submit"
                  disabled={editing}
                  className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
                >
                  {editing ? (
                    <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
                  ) : (
                    <Sparkles className="h-4 w-4" aria-hidden />
                  )}
                  {editing ? "Changing" : "Make the change"}
                </button>
              </div>
              <p className="mt-2 text-[11px] leading-4 text-ink-faint">
                The version before your change is kept, so you can put it back.
              </p>
            </form>
          ) : null}
        </>
      )}

      <div className="mt-2 empty:mt-0">
        <FormMessage error={visibility.error} notice={visibility.notice} />
        <FormMessage error={edit.error} notice={edit.notice} />
        <FormMessage error={undo.error} notice={undo.notice} />
      </div>
    </li>
  );
}

function WritableRow({ job }: { job: WritableJob }) {
  const [state, action, pending] = useActionState(writePostNow, initialState);

  return (
    <li className="rounded-control border border-line bg-surface p-3">
      <p className="text-xs text-ink-faint">
        {[job.jobNumber ? `Job ${job.jobNumber}` : "", when(job.completedAt)]
          .filter(Boolean)
          .join(" · ")}
      </p>
      <p className="mt-1 line-clamp-2 text-sm text-ink">{job.description || "No description"}</p>
      <form action={action} className="mt-2">
        <input type="hidden" name="jobId" value={job.id} />
        <button
          type="submit"
          disabled={pending}
          className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-3 text-xs font-semibold text-ink disabled:opacity-60"
        >
          {pending ? (
            <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
          )}
          {pending ? "Writing" : "Write a post"}
        </button>
      </form>
      <div className="mt-1.5">
        <FormMessage error={state.error} notice={state.notice} />
      </div>
    </li>
  );
}

export function JournalManager({
  posts,
  writable,
  publicHref,
}: {
  posts: OwnerPost[];
  writable: WritableJob[];
  /**
   * The journal's public index, for the per-post View links.
   *
   * Empty when the organization row has no slug, and both links are hidden
   * rather than rendered: `journalIndexPath("", false)` is `/journal/`, and the
   * public route needs an org segment, so a View button would open a 404.
   */
  publicHref: string;
}) {
  return (
    <>
      <section>
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Posts</h2>
          {posts.length > 0 && publicHref ? (
            <Link
              href={publicHref}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink-muted"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              See the journal
            </Link>
          ) : null}
        </div>

        {posts.length === 0 ? (
          <p className="mt-3 rounded-panel border border-dashed border-line p-6 text-center text-sm text-ink-muted">
            Nothing written yet. A post is written each time a job is completed.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {posts.map((post) => (
              <PostRow key={post.id} post={post} publicHref={publicHref} />
            ))}
          </ul>
        )}
      </section>

      {writable.length > 0 ? (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-ink">Jobs with no post</h2>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            Finished before this was switched on, or written up and refused. Nothing is published
            from these unless you ask.
          </p>
          <ul className="mt-3 space-y-2">
            {writable.map((job) => (
              <WritableRow key={job.id} job={job} />
            ))}
          </ul>
        </section>
      ) : null}
    </>
  );
}
