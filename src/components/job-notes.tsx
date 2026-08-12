"use client";

import { useActionState, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Mic, MicOff } from "lucide-react";

import {
  saveTechnicianNotes,
  type LineActionState,
} from "@/app/jobs/[jobId]/line-actions";

/**
 * What the technician writes down, on site.
 *
 * The job page had `customer_description` (the complaint) and `ai_summary` (a
 * machine's reading of it), both read-only. There was nowhere for "breaker was
 * backstabbed, replaced the receptacle, told the owner about the other three" —
 * so it went into a phone's notes app, or nowhere, and was gone by the time
 * anybody wrote the invoice.
 *
 * Never shown to the customer, and the label says so, because a notes field
 * somebody is unsure about is a notes field that stays empty.
 */

const initialState: LineActionState = { error: "" };

/** The vendor-prefixed constructor, without asserting it exists. */
type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
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

function speechRecognition(): SpeechRecognitionLike | null {
  const Constructor = recognitionConstructor();
  return Constructor ? new Constructor() : null;
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

function SaveButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
      Save notes
    </button>
  );
}

export function JobNotes({
  jobNumber,
  notes,
}: {
  jobNumber: string;
  notes: string;
}) {
  const [state, action] = useActionState(saveTechnicianNotes, initialState);
  const [value, setValue] = useState(notes);
  const [listening, setListening] = useState(false);

  // Checked on the client rather than guessed from the user agent. Firefox has
  // no SpeechRecognition at all, and a mic button that does nothing is worse
  // than no mic button.
  const dictationAvailable = useSyncExternalStore(
    subscribeToNothing,
    dictationOnClient,
    dictationOnServer,
  );

  const recognition = useRef<SpeechRecognitionLike | null>(null);

  // Stop the microphone if this unmounts mid-sentence. A recogniser left
  // running holds the mic indicator on after the page has gone.
  useEffect(() => {
    return () => {
      recognition.current?.stop();
      recognition.current = null;
    };
  }, []);

  function toggleDictation() {
    if (listening) {
      recognition.current?.stop();
      return;
    }

    const engine = speechRecognition();
    if (!engine) return;

    engine.continuous = true;
    engine.interimResults = false;
    engine.lang = "en-US";

    engine.onresult = (event) => {
      let heard = "";
      for (let index = 0; index < event.results.length; index += 1) {
        heard += event.results[index]?.[0]?.transcript ?? "";
      }
      const spoken = heard.trim();
      if (!spoken) return;

      // Appended to whatever is already typed rather than replacing it. Losing
      // a paragraph because somebody tapped the mic to add a sentence is the
      // sort of thing that stops a feature being used twice.
      setValue((current) => (current.trim() ? `${current.trim()} ${spoken}` : spoken));
    };

    // Both paths clear the flag: a denied microphone permission fires onerror
    // and never onend, and a button stuck on "listening" cannot be pressed again.
    engine.onerror = () => setListening(false);
    engine.onend = () => setListening(false);

    recognition.current = engine;
    engine.start();
    setListening(true);
  }

  return (
    <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Your notes</h2>
        <span className="text-xs text-ink-muted">Not shown to the customer</span>
      </div>

      <form action={action} className="mt-2 space-y-2">
        <input type="hidden" name="jobNumber" value={jobNumber} />

        <textarea
          name="notes"
          rows={4}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="What you found, what you did, what it needs next time."
          className="w-full rounded-control border border-line bg-surface p-3 text-sm leading-6"
        />

        {state.error ? <p className="text-xs text-critical">{state.error}</p> : null}
        {state.notice ? <p className="text-xs text-positive">{state.notice}</p> : null}

        <div className="flex gap-2">
          <SaveButton />

          {dictationAvailable ? (
            <button
              type="button"
              onClick={toggleDictation}
              aria-pressed={listening}
              className={`tap-target inline-flex min-h-12 items-center justify-center gap-2 rounded-control border px-4 text-sm font-semibold ${
                listening ? "border-brand bg-brand/10 text-brand" : "border-line"
              }`}
            >
              {listening ? (
                <MicOff className="h-4 w-4" aria-hidden />
              ) : (
                <Mic className="h-4 w-4" aria-hidden />
              )}
              {listening ? "Stop" : "Dictate"}
            </button>
          ) : null}
        </div>
      </form>
    </section>
  );
}
