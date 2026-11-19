"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, LoaderCircle, Sparkles } from "lucide-react";

import { draftJobScopeAction, saveJobScopeAction, type ScopeState } from "@/app/jobs/[jobId]/scope-actions";
import { inputClass } from "@/components/ui/field";
import { MAX_SCOPE_LENGTH } from "@/lib/job-scope";

/**
 * The scope of work, above Work & materials on the Estimate card.
 *
 * What the contract's "Scope of work" paragraph and the customer's estimate
 * say the job is. Typed, or summarised from the lines by AI and then read and
 * saved: nothing the model writes reaches the customer until somebody presses
 * Save. Saving also rewrites the job's draft contract.
 */

const initial: ScopeState = { error: "" };

export function JobScope({
  jobNumber,
  scope,
  hasLines,
  locked,
}: {
  jobNumber: string;
  scope: string;
  hasLines: boolean;
  /** A completed or canceled job: shown, not edited. */
  locked: boolean;
}) {
  const [saveState, save] = useActionState(saveJobScopeAction, initial);
  const [draftState, draft] = useActionState(draftJobScopeAction, initial);
  const [value, setValue] = useState(scope);
  const [last, setLast] = useState<"save" | "draft">("save");
  // A draft lands in the box, to be read and saved (set while rendering, the
  // way React suggests for state that follows other state).
  const [seenDraft, setSeenDraft] = useState(draftState);
  if (draftState !== seenDraft) {
    setSeenDraft(draftState);
    if (draftState.draft) setValue(draftState.draft);
  }

  if (locked) {
    return scope ? (
      <section className="mb-3 rounded-control border border-line p-3">
        <h3 className="text-sm font-semibold">Scope of work</h3>
        <p className="mt-1 whitespace-pre-line text-sm text-ink-muted">{scope}</p>
      </section>
    ) : null;
  }

  const state = last === "draft" ? draftState : saveState;

  return (
    <section aria-labelledby="job-scope-heading" className="mb-3 rounded-control border border-line p-3">
      <h3 id="job-scope-heading" className="text-sm font-semibold">
        Scope of work
      </h3>
      <p className="mt-1 text-xs leading-5 text-ink-muted">
        What the contract and estimate say the job is. Type it, or summarize the work and materials below.
      </p>
      <form
        action={(formData: FormData) => {
          setLast("save");
          save(formData);
        }}
      >
        <input type="hidden" name="jobNumber" value={jobNumber} />
        <textarea
          name="scope"
          aria-labelledby="job-scope-heading"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={MAX_SCOPE_LENGTH}
          rows={4}
          placeholder="Replace three receptacles in the bedroom with new 15A outlets and cover plates."
          className={`${inputClass} mt-2 min-h-28 py-3`}
        />
        <ScopeButtons
          hasLines={hasLines}
          dirty={value.trim() !== scope.trim()}
          draft={(formData: FormData) => {
            setLast("draft");
            draft(formData);
          }}
        />
      </form>
      {state.error ? (
        <p className="mt-2 text-sm text-critical" role="alert">
          {state.error}
        </p>
      ) : state.notice ? (
        <p className="mt-2 text-sm text-positive" role="status">
          {state.notice}
        </p>
      ) : null}
    </section>
  );
}

/** The two buttons, with Summarize posting the same form to the draft action. */
function ScopeButtons({
  hasLines,
  dirty,
  draft,
}: {
  hasLines: boolean;
  dirty: boolean;
  draft: (formData: FormData) => void;
}) {
  const { pending, data } = useFormStatus();
  const drafting = pending && data?.get("intent") === "draft";
  const saving = pending && !drafting;
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button
        type="submit"
        disabled={pending || !dirty}
        className="tap-target inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Check className="h-4 w-4" aria-hidden />}
        {saving ? "Saving…" : "Save scope"}
      </button>
      {hasLines ? (
        <button
          type="submit"
          name="intent"
          value="draft"
          formAction={draft}
          disabled={pending}
          className="tap-target inline-flex min-h-11 flex-1 items-center justify-center gap-1.5 rounded-control border border-brand/40 px-4 text-sm font-semibold text-brand disabled:opacity-60"
        >
          {drafting ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Sparkles className="h-4 w-4" aria-hidden />}
          {drafting ? "Writing…" : "Summarize the lines"}
        </button>
      ) : null}
    </div>
  );
}
