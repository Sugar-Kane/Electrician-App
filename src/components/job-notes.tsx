"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Mic, MicOff } from "lucide-react";

import { saveTechnicianNotes } from "@/app/jobs/[jobId]/line-actions";

/**
 * What the technician writes down, on site.
 *
 * There was a Save notes button, and it was the wrong shape for the job. Notes
 * are written in pieces — a line at the panel, a line back at the van, a line
 * while the customer talks — and every one of those pieces was a thing to
 * remember to save with a phone in one hand. What actually happened is that a
 * paragraph got typed, somebody tapped Navigate, and it was gone.
 *
 * So it saves itself, a second after typing stops, and says which of the two
 * states it is in. The only button left is the microphone, which is a different
 * kind of thing: it does something rather than confirming something.
 *
 * Never shown to the customer, and the label says so, because a notes field
 * somebody is unsure about is a notes field that stays empty.
 */

/** Long enough not to save mid-word, short enough to beat a distraction. */
const QUIET_MS = 1000;

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

type SaveState = "clean" | "saving" | "saved" | "failed";

export function JobNotes({ jobNumber, notes }: { jobNumber: string; notes: string }) {
  const [value, setValue] = useState(notes);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [error, setError] = useState("");
  const [listening, setListening] = useState(false);

  // What the server is known to hold. Compared against before every save so a
  // blur straight after an autosave does not post the same text twice.
  const saved = useRef(notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const dictationAvailable = useSyncExternalStore(
    subscribeToNothing,
    dictationOnClient,
    dictationOnServer,
  );

  const recognition = useRef<SpeechRecognitionLike | null>(null);

  const save = useCallback(
    async (text: string) => {
      if (text === saved.current) return;

      setSaveState("saving");
      const data = new FormData();
      data.set("jobNumber", jobNumber);
      data.set("notes", text);

      const result = await saveTechnicianNotes({ error: "" }, data);

      if (result.error) {
        setError(result.error);
        setSaveState("failed");
        return;
      }

      saved.current = text;
      setError("");
      setSaveState("saved");
    },
    [jobNumber],
  );

  function change(text: string) {
    setValue(text);
    setSaveState("clean");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(text), QUIET_MS);
  }

  // A pending save is flushed rather than dropped when the field is left, so
  // tapping Navigate a beat after typing does not lose the last sentence.
  function flush() {
    if (timer.current) clearTimeout(timer.current);
    void save(value);
  }

  // Stop the microphone if this unmounts mid-sentence. A recogniser left
  // running holds the mic indicator on after the page has gone.
  useEffect(() => {
    return () => {
      recognition.current?.stop();
      recognition.current = null;
      if (timer.current) clearTimeout(timer.current);
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
      setValue((current) => {
        const next = current.trim() ? `${current.trim()} ${spoken}` : spoken;
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => void save(next), QUIET_MS);
        return next;
      });
      setSaveState("clean");
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
    <section>
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-sm font-semibold">Job notes</h2>
        <p className="text-xs text-ink-muted" role="status" aria-live="polite">
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "Saved"
              : saveState === "failed"
                ? ""
                : "Not shown to the customer"}
        </p>
      </div>

      <textarea
        name="notes"
        rows={4}
        value={value}
        onChange={(event) => change(event.target.value)}
        onBlur={flush}
        aria-label="Job notes"
        placeholder="What did you find or repair?"
        className="mt-2 w-full rounded-control border border-line bg-raised p-3 text-base leading-6 outline-none placeholder:text-ink-faint focus:border-brand/70"
      />

      {saveState === "failed" ? (
        <p className="mt-1 text-xs text-critical">
          {error || "Those notes could not be saved."}{" "}
          <button type="button" onClick={flush} className="font-semibold underline">
            Try again
          </button>
        </p>
      ) : null}

      {dictationAvailable ? (
        <button
          type="button"
          onClick={toggleDictation}
          aria-pressed={listening}
          className={`tap-target mt-2 inline-flex min-h-12 items-center justify-center gap-2 rounded-control border px-4 text-sm font-semibold ${
            listening ? "border-brand bg-brand/10 text-brand" : "border-line"
          }`}
        >
          {listening ? <MicOff className="h-4 w-4" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
          {listening ? "Stop" : "Dictate"}
        </button>
      ) : null}
    </section>
  );
}
