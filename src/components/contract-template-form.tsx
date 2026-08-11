"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Save } from "lucide-react";

import { saveContractTemplate, type TemplateState } from "@/app/settings/contract/actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { CONTRACT_PLACEHOLDERS } from "@/lib/contract-template";

const initialState: TemplateState = { error: "" };

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex items-center gap-2 rounded-control bg-brand px-5 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Save className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Saving" : "Save contract"}
    </button>
  );
}

export function ContractTemplateForm({ body }: { body: string }) {
  const [state, action] = useActionState(saveContractTemplate, initialState);

  return (
    <form action={action} className="space-y-4">
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Your contract</h2>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          Paste the contract you already use. Anywhere a job detail belongs, put one of the
          placeholders below and it will be filled in when you generate a contract from a job.
          Everything else is left exactly as you wrote it.
        </p>

        <textarea
          name="body"
          defaultValue={body}
          rows={22}
          spellCheck={false}
          className={`${inputClass} mt-4 min-h-[420px] py-3 font-mono text-sm leading-6`}
        />
      </section>

      <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
        <h2 className="text-sm font-semibold">Placeholders</h2>
        <dl className="mt-3 grid gap-2 sm:grid-cols-2">
          {CONTRACT_PLACEHOLDERS.map((entry) => (
            <div key={entry.key} className="flex items-baseline gap-2">
              <dt>
                <code className="rounded-chip bg-white/[0.06] px-1.5 py-0.5 text-xs text-brand">
                  {`{{${entry.key}}}`}
                </code>
              </dt>
              <dd className="text-xs text-ink-muted">{entry.describes}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-3 text-xs leading-5 text-ink-faint">
          <code className="text-brand">{"{{scope}}"}</code> is the one part written for you, from
          what the customer described. It never states a price or a date — those come from the job.
          Anything you write that this app does not recognise stays in the contract for you to fill
          in by hand.
        </p>
      </section>

      <FormMessage error={state.error} notice={state.notice} />
      <SaveButton />
    </form>
  );
}
