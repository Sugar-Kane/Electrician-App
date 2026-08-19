"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { saveTechnicianNotes } from "@/app/jobs/[jobId]/line-actions";
import { DictateButton } from "@/components/dictate-button";

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

type SaveState = "clean" | "saving" | "saved" | "failed";

export function JobNotes({ jobNumber, notes }: { jobNumber: string; notes: string }) {
  const [value, setValue] = useState(notes);
  const [saveState, setSaveState] = useState<SaveState>("clean");
  const [error, setError] = useState("");

  // What the server is known to hold. Compared against before every save so a
  // blur straight after an autosave does not post the same text twice.
  const saved = useRef(notes);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

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

      {/*
        Dictated words go through `change`, the same path typing takes, so
        speaking a note and walking away persists it exactly as typing one and
        walking away does.
      */}
      <div className="mt-2 flex flex-wrap items-center">
        <DictateButton value={value} onText={change} variant="labelled" />
      </div>
    </section>
  );
}
