"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, SendHorizontal, Sparkles } from "lucide-react";

import { askAssistant, type AssistantState } from "@/app/assistant/actions";

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

const initialState: AssistantState = { turns: [], error: "" };

const SUGGESTIONS = [
  "What is booked tomorrow?",
  "Which invoices are unpaid?",
  "How full is next week?",
  "Which jobs have no technician assigned?",
];

function SendButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
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

function Thinking() {
  const { pending } = useFormStatus();
  if (!pending) return null;

  return (
    <div className="flex justify-start">
      <p className="max-w-[85%] rounded-panel border border-line bg-surface px-4 py-3 text-sm text-ink-faint">
        Reading the schedule…
      </p>
    </div>
  );
}

export function AssistantChat() {
  const [state, action] = useActionState(askAssistant, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [state.turns.length]);

  return (
    <div className="flex min-h-[60vh] flex-col gap-3">
      <div className="flex-1 space-y-3">
        {state.turns.length === 0 ? (
          <div className="rounded-panel border border-line bg-surface p-5">
            <Sparkles className="h-5 w-5 text-brand" aria-hidden />
            <p className="mt-3 text-sm font-semibold">Ask about the business</p>
            <p className="mt-1 text-sm leading-6 text-ink-muted">
              It can read this business&rsquo;s jobs and invoices — nothing else, and nothing
              belonging to anyone else. It cannot book, cancel, or send anything.
            </p>
            <div className="mt-4 grid gap-2 sm:grid-cols-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => {
                    const field = formRef.current?.elements.namedItem(
                      "question",
                    ) as HTMLInputElement | null;
                    if (!field) return;
                    field.value = suggestion;
                    formRef.current?.requestSubmit();
                  }}
                  className="tap-target rounded-control border border-line px-3 py-2 text-left text-xs text-ink-muted hover:text-ink"
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
            <p
              className={`max-w-[85%] whitespace-pre-wrap rounded-panel px-4 py-3 text-sm leading-6 ${
                turn.role === "user"
                  ? "bg-brand text-on-brand"
                  : "border border-line bg-surface text-ink"
              }`}
            >
              {turn.text}
            </p>
          </div>
        ))}

        <Form action={action} formRef={formRef} error={state.error} />
        <div ref={endRef} />
      </div>
    </div>
  );
}

/**
 * Split out so `useFormStatus` can see the pending state.
 *
 * The hook only reports on a form above it in the tree, so the thinking line
 * and the send button have to live inside the form element rather than beside
 * it.
 */
function Form({
  action,
  formRef,
  error,
}: {
  action: (formData: FormData) => void;
  formRef: React.RefObject<HTMLFormElement | null>;
  error: string;
}) {
  return (
    <form
      ref={formRef}
      action={(formData) => {
        action(formData);
        formRef.current?.reset();
      }}
      className="space-y-3"
    >
      <Thinking />

      {error ? (
        <p className="rounded-control border border-critical/25 bg-critical-bg px-3 py-2 text-sm text-critical">
          {error}
        </p>
      ) : null}

      <div className="sticky bottom-2 flex gap-2">
        <input
          name="question"
          type="text"
          maxLength={500}
          autoComplete="off"
          placeholder="What is booked tomorrow?"
          className="min-h-12 w-full rounded-control border border-line bg-raised px-4 text-base outline-none placeholder:text-ink-faint focus:border-brand/70"
        />
        <SendButton />
      </div>
    </form>
  );
}
