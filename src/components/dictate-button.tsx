"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, Square } from "lucide-react";

import { joinSpoken, spokenSince } from "@/lib/dictation";

/**
 * Dictation, wherever there is a box to type into.
 *
 * This used to live inside the job notes field and nowhere else, which meant a
 * technician could speak a note into a job but had to thumb-type a text to the
 * customer standing in front of them. The recogniser, the capability check and
 * the two ways it can stop are the same everywhere, so they are here once.
 *
 * `onText` receives the words heard, already joined onto whatever was passed as
 * `value` — the caller just stores the result. Passing the current value in
 * rather than keeping it here is deliberate: the box is the caller's state, and
 * a component that held its own copy would fight whatever else writes to it.
 */

/** The vendor-prefixed constructor, without asserting it exists. */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

function recognitionConstructor(): (new () => SpeechRecognitionLike) | undefined {
  if (typeof window === "undefined") return undefined;

  const holder = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };

  return holder.SpeechRecognition ?? holder.webkitSpeechRecognition;
}

/**
 * Whether this browser can dictate, read the way a browser capability should be.
 *
 * The server has no `window`, so the first paint must say "no" on both sides or
 * hydration mismatches. `useSyncExternalStore` with a server snapshot of false
 * is exactly that, and unlike a `useEffect` that calls `setState` it does not
 * cost a second render on every browser that does support it.
 *
 * Nothing to subscribe to: whether the API exists cannot change while the page
 * is open.
 */
const subscribeToNothing = () => () => {};
const dictationOnClient = () => recognitionConstructor() !== undefined;
const dictationOnServer = () => false;

export function useDictationAvailable(): boolean {
  return useSyncExternalStore(subscribeToNothing, dictationOnClient, dictationOnServer);
}

export function DictateButton({
  value,
  onText,
  variant = "icon",
  className = "",
}: {
  /** What is in the box now. Dictated words are appended to it. */
  value: string;
  onText: (next: string) => void;
  /** `labelled` for a form; `icon` for a round button beside a composer. */
  variant?: "icon" | "labelled";
  className?: string;
}) {
  const available = useDictationAvailable();
  const [listening, setListening] = useState(false);
  const [denied, setDenied] = useState(false);

  const engine = useRef<SpeechRecognitionLike | null>(null);
  /** How many results have been folded in already. See `spokenSince`. */
  const read = useRef(0);

  // Read through refs so the recogniser's handlers always see the current text
  // without the recogniser being torn down and rebuilt on every keystroke. Kept
  // current in an effect rather than assigned while rendering: the handlers only
  // ever fire from browser events, which is long after the effect has run.
  const latest = useRef(value);
  const emit = useRef(onText);

  useEffect(() => {
    latest.current = value;
    emit.current = onText;
  });

  // A recogniser left running holds the microphone indicator on after the page
  // has gone. Stopping it on unmount is the whole reason this is a ref.
  useEffect(() => {
    return () => {
      engine.current?.stop();
      engine.current = null;
    };
  }, []);

  const toggle = useCallback(() => {
    if (listening) {
      engine.current?.stop();
      return;
    }

    const Constructor = recognitionConstructor();
    if (!Constructor) return;

    const next = new Constructor();
    next.continuous = true;
    next.interimResults = false;
    next.lang = "en-US";
    read.current = 0;

    next.onresult = (event) => {
      const spoken = spokenSince(event.results, read.current);
      read.current = event.results.length;
      if (spoken) emit.current(joinSpoken(latest.current, spoken));
    };

    /*
     * Both paths clear the flag, and they are genuinely different events: a
     * refused microphone fires `onerror` and never `onend`, and a button stuck
     * on "listening" cannot be pressed again.
     *
     * A refusal is the one worth saying out loud. Everything else — a pause too
     * long, no network for the recogniser — is noise the person can respond to
     * by pressing the button again, and a red banner for it would be a lie
     * about how serious it is.
     */
    next.onerror = (event) => {
      setListening(false);
      if (event?.error === "not-allowed" || event?.error === "service-not-allowed") {
        setDenied(true);
      }
    };
    next.onend = () => setListening(false);

    engine.current = next;
    setDenied(false);

    // `start()` throws if the browser refuses outright — an insecure origin, or
    // a recogniser already running in another tab. Failing to a silent button
    // beats failing to an error overlay on top of somebody's message.
    try {
      next.start();
      setListening(true);
    } catch {
      setListening(false);
    }
  }, [listening]);

  if (!available) return null;

  const shell =
    variant === "labelled"
      ? `tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border px-4 text-sm font-semibold ${
          listening ? "border-brand bg-brand/10 text-brand" : "border-line"
        }`
      : `tap-target grid h-12 w-12 shrink-0 place-items-center rounded-full border ${
          listening ? "border-brand bg-brand/15 text-brand" : "border-line bg-raised text-ink-muted"
        }`;

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        aria-pressed={listening}
        aria-label={listening ? "Stop dictating" : "Dictate a message"}
        className={`${shell} ${className}`}
      >
        {listening ? (
          <Square className="h-4 w-4 fill-current" aria-hidden />
        ) : (
          <Mic className={variant === "labelled" ? "h-4 w-4" : "h-5 w-5"} aria-hidden />
        )}
        {variant === "labelled" ? (listening ? "Stop" : "Dictate") : null}
      </button>

      {/*
        Spoken aloud rather than shown, when it is only a state. A listening
        indicator that takes up a line pushes the message box around every time
        the microphone is tapped.
      */}
      <span className="sr-only" role="status" aria-live="polite">
        {listening ? "Listening" : ""}
      </span>

      {denied ? (
        <p className="mt-2 w-full text-xs leading-5 text-caution">
          This browser is not allowed to use the microphone. Turn it on for this site in your
          browser settings, then tap the microphone again.
        </p>
      ) : null}
    </>
  );
}
