"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  AlertTriangle,
  Check,
  CheckCheck,
  Clock3,
  LoaderCircle,
  MoonStar,
  SendHorizontal,
  ShieldCheck,
  TriangleAlert,
} from "lucide-react";

import {
  sendConversationMessage,
  type SendMessageState,
} from "@/app/messages/actions";
import type { ConversationThread } from "@/lib/messaging";

const initialState: SendMessageState = { error: "" };

// Every date here is formatted in the business timezone, explicitly. Left to
// the ambient zone these render as UTC on the server and local in the browser,
// which is both a hydration mismatch and the wrong day on the separators.
function formatTime(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function dayKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function formatDayLabel(iso: string, timeZone: string) {
  const date = new Date(iso);
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const key = dayKey(date, timeZone);
  if (key === dayKey(now, timeZone)) return "Today";
  if (key === dayKey(yesterday, timeZone)) return "Yesterday";

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(date);
}

/** Delivery state, shown the way a messaging app shows it: quiet until it isn't. */
function DeliveryState({ status, errorDetail }: { status: string; errorDetail: string | null }) {
  if (status === "failed" || status === "undelivered") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-red-300">
        <TriangleAlert className="h-3 w-3" aria-hidden />
        {errorDetail ?? "Not delivered"}
      </span>
    );
  }
  if (status === "delivered") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-slate-400">
        <CheckCheck className="h-3 w-3" aria-hidden /> Delivered
      </span>
    );
  }
  if (status === "sent") {
    return (
      <span className="flex items-center gap-1 text-[11px] text-slate-500">
        <Check className="h-3 w-3" aria-hidden /> Sent
      </span>
    );
  }
  return (
    <span className="flex items-center gap-1 text-[11px] text-slate-500">
      <Clock3 className="h-3 w-3" aria-hidden /> Sending…
    </span>
  );
}

function SendButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={disabled || pending}
      aria-label="Send message"
      className="tap-target grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[#ffc21c] text-[#071723] disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-500"
    >
      {pending ? (
        <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
      ) : (
        <SendHorizontal className="h-5 w-5" aria-hidden />
      )}
    </button>
  );
}

export function MessageThread({ thread }: { thread: ConversationThread }) {
  const [body, setBody] = useState("");
  const [overrideQuietHours, setOverrideQuietHours] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const action = sendConversationMessage.bind(null, thread.id);
  // Clearing the box lives in the action rather than an effect: on a failed
  // send the text the user typed has to survive so they can retry it.
  const [state, formAction] = useActionState(
    async (previous: SendMessageState, formData: FormData) => {
      const result = await action(previous, formData);
      if (result.sent) {
        setBody("");
        setOverrideQuietHours(false);
      }
      return result;
    },
    initialState,
  );

  // Land at the newest message, the way every messaging app opens.
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end" });
  }, [thread.messages.length]);

  // Day separators are worked out before render rather than by mutating a
  // variable while mapping.
  const timeZone = thread.quietHours.timezone;
  const rendered = thread.messages.map((message, index) => {
    const day = formatDayLabel(message.createdAt, timeZone);
    const previous =
      index > 0 ? formatDayLabel(thread.messages[index - 1].createdAt, timeZone) : "";
    return { message, day, showDay: day !== previous };
  });

  return (
    <div className="flex min-h-[60vh] flex-col rounded-3xl border border-white/10 bg-[#0b1b27]">
      <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-5">
        {thread.messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-slate-500">
            No messages yet. Anything you send starts the thread.
          </p>
        ) : null}

        {rendered.map(({ message, day, showDay }) => {
          const outbound = message.direction === "outbound";

          return (
            <div key={message.id}>
              {showDay ? (
                <p className="my-4 text-center text-[11px] font-medium uppercase tracking-[0.14em] text-slate-600">
                  {day}
                </p>
              ) : null}
              <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] sm:max-w-[70%] ${outbound ? "items-end" : "items-start"} flex flex-col gap-1`}>
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-6 ${
                      outbound
                        ? "rounded-br-md bg-[#ffc21c] text-[#071723]"
                        : "rounded-bl-md bg-[#14293a] text-slate-100"
                    }`}
                  >
                    {message.body}
                  </div>
                  <div className="flex items-center gap-2 px-1">
                    <span className="text-[11px] text-slate-600">
                      {formatTime(message.createdAt, timeZone)}
                    </span>
                    {outbound ? (
                      <DeliveryState status={message.status} errorDetail={message.errorDetail} />
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
        <div ref={endRef} />
      </div>

      <div className="border-t border-white/10 p-3 sm:p-4">
        {thread.canSend ? (
          <>
            {thread.quietHours.currentlyQuiet ? (
              <p className="mb-3 flex items-start gap-2 rounded-2xl border border-indigo-300/25 bg-indigo-300/[0.07] p-3 text-xs leading-5 text-indigo-100">
                <MoonStar className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                It is quiet hours for this business ({thread.quietHours.start.slice(0, 5)}–
                {thread.quietHours.end.slice(0, 5)}). Send only if the customer needs to know now.
              </p>
            ) : null}

            <form ref={formRef} action={formAction} className="flex items-end gap-2">
              <input
                type="hidden"
                name="overrideQuietHours"
                value={overrideQuietHours ? "yes" : "no"}
              />
              <label className="sr-only" htmlFor="message-body">
                Message
              </label>
              <textarea
                id="message-body"
                name="body"
                rows={1}
                value={body}
                onChange={(event) => setBody(event.target.value.slice(0, 1600))}
                onKeyDown={(event) => {
                  // Enter sends, Shift+Enter makes a new line — the convention
                  // every messaging app has trained people on.
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    if (body.trim()) formRef.current?.requestSubmit();
                  }
                }}
                placeholder="Message…"
                className="max-h-40 min-h-12 flex-1 resize-y rounded-2xl border border-white/10 bg-[#0d202d] px-4 py-3 text-base leading-6 text-white outline-none placeholder:text-slate-600 focus:border-[#ffc21c]/70"
              />
              <SendButton disabled={body.trim().length === 0} />
            </form>

            <div className="mt-2 flex items-center justify-between px-1">
              <span className="flex items-center gap-1.5 text-[11px] text-slate-600">
                <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" aria-hidden />
                Opted in{thread.consent.source ? ` · ${thread.consent.source.replace(/_/g, " ")}` : ""}
              </span>
              <span className="text-[11px] text-slate-600">{body.length}/1600</span>
            </div>
          </>
        ) : (
          <div className="flex items-start gap-2 rounded-2xl border border-amber-300/25 bg-amber-300/[0.07] p-4 text-sm leading-6 text-amber-100">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <div>
              <p className="font-semibold">You cannot text this customer.</p>
              <p className="mt-1">{thread.blockedReason}</p>
            </div>
          </div>
        )}

        {state.error ? (
          <p role="alert" className="mt-3 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-3 text-sm text-red-200">
            {state.error}
            {state.quietHoursBlocked ? (
              <button
                type="button"
                onClick={() => {
                  setOverrideQuietHours(true);
                  formRef.current?.requestSubmit();
                }}
                className="tap-target ml-2 font-semibold underline"
              >
                Send anyway
              </button>
            ) : null}
          </p>
        ) : null}
      </div>
    </div>
  );
}
