"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, LoaderCircle, SendHorizontal, Sparkles, X } from "lucide-react";

import {
  AttachButton,
  AttachmentChips,
  type Attachment,
} from "@/components/assistant-attachments";
import { ChatMarkdown } from "@/components/ui/chat-markdown";

import { chatAction, type ChatState } from "@/app/assistant/agent-actions";

/**
 * Asking the business a question.
 *
 * A chat window rather than a search box, because the questions an owner
 * actually has are follow-ups: "how full is next week" then "who is the
 * Thursday one for" then "has she paid". A search box makes each of those a
 * fresh, fully-specified query.
 *
 * The assistant can only read, and says so. Anything that changes the business
 * happens on a screen with a button on it, where there is a record of who
 * pressed it.
 */

const initialState: ChatState = { turns: [], error: "" };

const SUGGESTIONS = [
  "What is booked tomorrow?",
  "Which invoices are unpaid?",
  "How full is next week?",
  "Which jobs have no technician assigned?",
  "Do I have a 20 amp AFCI breaker?",
  "What permit do I need for a service upgrade?",
];

/*
 * Pending comes from `useActionState` rather than `useFormStatus`.
 *
 * `useFormStatus` only reports on a form above it in the tree, which forced the
 * thinking line and the send button to live inside the same `<form>` — and so
 * forced the question box to sit inside the scrolling list. Reading it from the
 * action instead frees the two to sit where they belong: the answer-in-progress
 * at the end of the thread, the button in the composer.
 */
function SendButton({ pending, waiting = false }: { pending: boolean; waiting?: boolean }) {
  return (
    <button
      type="submit"
      disabled={pending || waiting}
      aria-label="Ask"
      className="tap-target grid h-12 w-12 shrink-0 place-items-center rounded-control bg-brand text-on-brand disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <SendHorizontal className="h-4 w-4" aria-hidden />
      )}
    </button>
  );
}

function Thinking({ pending }: { pending: boolean }) {
  if (!pending) return null;

  return (
    <div className="flex justify-start">
      <p
        className="max-w-[85%] rounded-panel border border-line bg-raised px-4 py-3 text-sm text-ink-faint"
        aria-live="polite"
      >
        Reading the schedule…
      </p>
    </div>
  );
}

export function AssistantChat() {
  const [state, action, pending] = useActionState(chatAction, initialState);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const formRef = useRef<HTMLFormElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Only the ones that made it to storage ride on the question; a chip still
  // uploading or already failed carries nothing the server could look up.
  const ready = attachments.filter((item) => item.state === "ready" && item.documentId);
  const settling = attachments.some((item) => item.state === "uploading");

  /*
   * Land at the newest answer, the way every chat window opens.
   *
   * The scroll container is set directly rather than through
   * `scrollIntoView` on a trailing element: this list lives inside a frame
   * with a real height, and `scrollIntoView` walks up scrolling every ancestor
   * it finds, which on a phone drags the whole app around to satisfy a request
   * about one box.
   *
   * Runs on mount too, not only when a turn arrives, so arriving at a chat that
   * already has answers in it starts at the bottom.
   */
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [state.turns.length, pending, state.proposal]);

  /*
   * Tapping a suggestion is asking the question, by exactly the path typing it
   * would take: put the words in the box, submit the box. Nothing about a tap
   * should reach the model differently from a keystroke.
   */
  function ask(question: string) {
    if (pending) return;

    const field = formRef.current?.elements.namedItem(
      "question",
    ) as HTMLInputElement | null;
    if (!field) return;

    field.value = question;
    formRef.current?.requestSubmit();
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-panel border border-line bg-surface">
      <div
        ref={listRef}
        className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-3 sm:p-4"
      >
        {state.turns.length === 0 ? (
          // No border of its own any more: it sits inside the chat frame now,
          // and a panel inside a panel is two boxes saying one thing.
          <div className="px-1 py-2">
            <Sparkles className="h-5 w-5 text-brand" aria-hidden />
            <p className="mt-3 text-sm font-semibold">Ask about the business</p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              It reads this business&rsquo;s own jobs, invoices, stock and code
              requirements. Anything that reaches a customer or changes a record is shown to
              you first and waits for a tap.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => ask(suggestion)}
                  disabled={pending}
                  className="tap-target rounded-control border border-line px-3 py-2 text-left text-xs text-ink-muted hover:text-ink disabled:opacity-50"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {state.turns.map((turn, index) => (
          <div
            key={`${index}-${turn.role}`}
            className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
          >
            <div
              className={`max-w-[85%] rounded-panel px-4 py-3 text-sm leading-6 ${
                turn.role === "user"
                  ? "bg-brand text-on-brand"
                  : "border border-line bg-surface text-ink"
              }`}
            >
              <ChatMarkdown text={turn.text} />
            </div>
          </div>
        ))}

        <Thinking pending={pending} />
      </div>

      {/*
        Outside the scroll area, so the question box is always where the thumb
        expects it rather than at the end of however much has been said. It used
        to be `sticky` inside the list, which put it below the answers on a
        short conversation and floating over them on a long one.
      */}
      <div className="shrink-0 border-t border-line p-3 sm:p-4">
        {/*
          The suggestions used to exist only on an empty chat, so the moment you
          asked one thing there was nothing left to tap and the next question had
          to be typed out in full. They live here too now, beside the box, for as
          long as the conversation lasts.

          A row that scrolls sideways rather than a grid: these are sentences,
          and six of them stacked would push the answers off a phone. Hidden
          while a proposal is waiting, because the only thing to decide then is
          the proposal.
        */}
        {state.turns.length > 0 && !state.proposal ? (
          <div
            className="-mx-3 mb-3 flex gap-2 overflow-x-auto overscroll-x-contain px-3 pb-1 sm:-mx-4 sm:px-4"
            aria-label="Suggested questions"
          >
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                onClick={() => ask(suggestion)}
                disabled={pending}
                className="tap-target min-h-11 shrink-0 whitespace-nowrap rounded-chip border border-line px-3 text-xs text-ink-muted hover:text-ink disabled:opacity-50"
              >
                {suggestion}
              </button>
            ))}
          </div>
        ) : null}

        {state.proposal ? (
          <ProposalCard proposal={state.proposal} action={action} />
        ) : (
          <>
            <AttachmentChips
              attachments={attachments}
              onRemove={(key) =>
                setAttachments((current) => current.filter((item) => item.key !== key))
              }
            />
            <Form
              action={action}
              formRef={formRef}
              error={state.error}
              pending={pending}
              attachments={attachments}
              ready={ready}
              settling={settling}
              onAttachmentsChange={setAttachments}
              onSent={() => setAttachments([])}
            />
          </>
        )}
      </div>
    </div>
  );
}

function Form({
  action,
  formRef,
  error,
  pending,
  attachments,
  ready,
  settling,
  onAttachmentsChange,
  onSent,
}: {
  action: (formData: FormData) => void;
  formRef: React.RefObject<HTMLFormElement | null>;
  error: string;
  pending: boolean;
  attachments: Attachment[];
  ready: Attachment[];
  settling: boolean;
  onAttachmentsChange: (next: (current: Attachment[]) => Attachment[]) => void;
  onSent: () => void;
}) {
  return (
    <form
      ref={formRef}
      action={(formData) => {
        action(formData);
        formRef.current?.reset();
        // The files belong to the question that just left. Clearing them here
        // rather than on the answer means the next question starts empty even
        // if this one fails.
        onSent();
      }}
      className="space-y-3"
    >
      {/*
        The document ids ride in the form itself, so the existing FormData
        contract carries them with no separate channel to keep in step.
      */}
      {ready.map((item) => (
        <input key={item.key} type="hidden" name="attachment" value={item.documentId} />
      ))}
      {error ? (
        <p className="rounded-control border border-critical/25 bg-critical-bg px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      <div className="flex gap-2">
        <AttachButton
          attachments={attachments}
          onChange={onAttachmentsChange}
          disabled={pending}
        />
        <input
          name="question"
          type="text"
          maxLength={500}
          autoComplete="off"
          placeholder="What is booked tomorrow?"
          className="min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base outline-none placeholder:text-ink-faint focus:border-brand/70"
        />
        {/*
          Held while a file is still going up. Sending now would ask about a
          photo the server cannot see yet, and the answer would be about
          nothing.
        */}
        <SendButton pending={pending} waiting={settling} />
      </div>
    </form>
  );
}

/**
 * An action waiting for a tap.
 *
 * Replaces the message box rather than sitting beside it, so the next thing the
 * person does is decide about this. A proposal that can be scrolled past while
 * typing the next question is a proposal that gets left pending and forgotten,
 * and "I asked it to text Dana" would then be false.
 */
function ProposalCard({
  proposal,
  action,
}: {
  proposal: NonNullable<ChatState["proposal"]>;
  action: (formData: FormData) => void;
}) {
  return (
    <form action={action} className="rounded-panel border border-brand/40 bg-brand/[0.06] p-4">
      <input type="hidden" name="proposal" value={JSON.stringify(proposal)} />

      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-brand">
        Waiting for you
      </p>
      <p className="mt-2 text-sm leading-6">{proposal.summary}</p>

      <Working />

      <div className="mt-4 flex flex-wrap gap-2">
        <ConfirmButton />
        <button
          type="submit"
          name="intent"
          value="cancel"
          className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-4 text-sm font-semibold text-ink-muted"
        >
          <X className="h-4 w-4" aria-hidden />
          Cancel
        </button>
      </div>
    </form>
  );
}

/**
 * What the person sees between tapping and the answer arriving.
 *
 * Sending an invoice takes a couple of seconds against two providers, and a
 * button that dims with nothing else changing reads as a tap that missed.
 */
function Working() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <p className="mt-3 flex items-center gap-2 text-xs text-ink-muted" aria-live="polite">
      <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
      Doing it now…
    </p>
  );
}

function ConfirmButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="intent"
      value="confirm"
      disabled={pending}
      className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Check className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Doing it" : "Confirm"}
    </button>
  );
}

