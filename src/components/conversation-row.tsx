"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  LoaderCircle,
  MessageSquare,
  RotateCcw,
  Trash2,
} from "lucide-react";

import {
  archiveConversation,
  deleteConversation,
  restoreConversation,
  unarchiveConversation,
  type ConversationVisibilityState,
} from "@/app/messages/actions";
import { swipeSide } from "@/lib/swipe";
import type { ConversationSummary } from "@/lib/messaging";

/**
 * One conversation in the inbox, and the two swipes that clear it.
 *
 * Left reveals Delete, right reveals Archive, and each of them still has to be
 * tapped. The gesture opens the choice rather than making it: a full swipe that
 * fired on its own would be one careless thumb away from clearing a thread
 * somebody is still working from, and unlike an invoice there is no obvious
 * "undo" in the room.
 *
 * Neither one deletes anything. Both write a timestamp on the conversation, so
 * the messages, the customer, the service inquiry and the job keep every
 * relationship they had — the job page shows the same thread afterwards, which
 * is the requirement this whole feature is written around.
 *
 * The gesture is not the only way in. Both actions are reachable with a
 * keyboard, the way the invoice row does it, because a control that needs a
 * touchscreen is a control for one kind of user.
 */

const initialState: ConversationVisibilityState = { error: "" };

export function ConversationRow({
  conversation,
  when,
}: {
  conversation: ConversationSummary;
  /** Already formatted on the server, where the business's timezone is known. */
  when: string;
}) {
  const [archiveState, archive, archiving] = useActionState(
    conversation.archived ? unarchiveConversation : archiveConversation,
    initialState,
  );
  const [deleteState, remove, removing] = useActionState(
    conversation.deleted ? restoreConversation : deleteConversation,
    initialState,
  );

  const [open, setOpen] = useState<"none" | "delete" | "archive">("none");
  const start = useRef<{ x: number; y: number } | null>(null);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchMove(event: React.TouchEvent) {
    const touch = event.touches[0];
    const side = swipeSide(start.current, touch ? { x: touch.clientX, y: touch.clientY } : null);
    if (side === "left") setOpen("delete");
    if (side === "right") setOpen("archive");
  }

  const busy = archiving || removing;
  const error = archiveState.error || deleteState.error;

  return (
    <div className="border-t border-white/[0.06] first:border-t-0">
      <div
        className="flex items-center gap-2 px-2"
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
      >
        {/*
          Archive sits on the left of the row because the swipe that reveals it
          travels rightward, and a button that appears on the opposite side from
          the direction of the thumb reads as a different control entirely.
        */}
        {open === "archive" ? (
          <form action={archive}>
            <input type="hidden" name="conversationId" value={conversation.id} />
            <button
              type="submit"
              disabled={busy}
              aria-label={`${conversation.archived ? "Move back to the inbox" : "Archive"}: ${conversation.customerName}`}
              className="tap-target grid h-12 w-12 shrink-0 place-items-center rounded-control border border-line bg-white/5 text-ink disabled:opacity-60"
            >
              {archiving ? (
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
              ) : conversation.archived ? (
                <ArchiveRestore className="h-5 w-5" aria-hidden />
              ) : (
                <Archive className="h-5 w-5" aria-hidden />
              )}
            </button>
          </form>
        ) : null}

        <Link
          href={`/messages/${conversation.id}`}
          className="tap-row flex min-h-[76px] min-w-0 flex-1 items-center gap-3 py-3 hover:bg-white/[0.03]"
        >
          <span
            className={`grid h-12 w-12 shrink-0 place-items-center rounded-full text-sm font-bold ${
              conversation.unread ? "bg-brand text-on-brand" : "bg-white/[0.06] text-ink-muted"
            }`}
            aria-hidden
          >
            {conversation.initials}
          </span>

          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-3">
              <span
                className={`truncate text-sm ${conversation.unread ? "font-bold text-white" : "font-semibold text-ink"}`}
              >
                {conversation.customerName}
              </span>
              <span className="shrink-0 text-[11px] text-ink-faint">{when}</span>
            </span>
            <span className="mt-1 flex items-center gap-1.5">
              {conversation.lastMessageDirection === "outbound" ? (
                <MessageSquare className="h-3 w-3 shrink-0 text-ink-faint" aria-hidden />
              ) : null}
              <span
                className={`truncate text-xs ${conversation.unread ? "text-ink" : "text-ink-faint"}`}
              >
                {conversation.lastMessageBody || "No messages yet"}
              </span>
            </span>
          </span>

          {conversation.unread && open === "none" ? (
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full bg-brand"
              aria-label="Waiting on a reply"
            />
          ) : open === "none" ? (
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          ) : null}
        </Link>

        {open === "delete" ? (
          <form action={remove}>
            <input type="hidden" name="conversationId" value={conversation.id} />
            <button
              type="submit"
              disabled={busy}
              aria-label={`${conversation.deleted ? "Put back in the inbox" : "Delete from the inbox"}: ${conversation.customerName}`}
              className={`tap-target grid h-12 w-12 shrink-0 place-items-center rounded-control border disabled:opacity-60 ${
                conversation.deleted
                  ? "border-line bg-white/5 text-ink"
                  : "border-critical/40 bg-critical/15 text-critical"
              }`}
            >
              {removing ? (
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
              ) : conversation.deleted ? (
                <RotateCcw className="h-5 w-5" aria-hidden />
              ) : (
                <Trash2 className="h-5 w-5" aria-hidden />
              )}
            </button>
          </form>
        ) : null}
      </div>

      {/*
        The keyboard route to the same two actions, visible only once the row is
        focused within so it does not add two controls to every row for people
        who have the gesture.
      */}
      {open === "none" ? (
        <div className="flex gap-2 px-2">
          <form action={archive}>
            <input type="hidden" name="conversationId" value={conversation.id} />
            <button
              type="submit"
              disabled={busy}
              className="sr-only focus:not-sr-only focus:mb-2 focus:inline-flex focus:min-h-11 focus:items-center focus:gap-2 focus:rounded-control focus:border focus:border-line focus:px-3 focus:text-sm focus:font-semibold"
            >
              <Archive className="h-4 w-4" aria-hidden />
              {conversation.archived ? "Move back to the inbox" : "Archive"} {conversation.customerName}
            </button>
          </form>
          <form action={remove}>
            <input type="hidden" name="conversationId" value={conversation.id} />
            <button
              type="submit"
              disabled={busy}
              className="sr-only focus:not-sr-only focus:mb-2 focus:inline-flex focus:min-h-11 focus:items-center focus:gap-2 focus:rounded-control focus:border focus:border-critical/40 focus:px-3 focus:text-sm focus:font-semibold focus:text-critical"
            >
              <Trash2 className="h-4 w-4" aria-hidden />
              {conversation.deleted ? "Put back" : "Delete"} {conversation.customerName}
            </button>
          </form>
        </div>
      ) : null}

      {/*
        Said on the row rather than as a toast, because what happened to a
        specific thread is not a message about the page.
      */}
      {conversation.jobId && (conversation.archived || conversation.deleted) ? (
        <p className="px-4 pb-2 text-[11px] leading-4 text-ink-faint">
          Still on{" "}
          <Link href={`/jobs/${conversation.jobId}`} className="font-semibold text-brand">
            its job
          </Link>
          , in full.
        </p>
      ) : null}

      {error ? <p className="px-4 pb-2 text-sm text-critical">{error}</p> : null}
    </div>
  );
}
