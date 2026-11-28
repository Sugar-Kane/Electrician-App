"use client";

import { useActionState } from "react";
import { LoaderCircle } from "lucide-react";

import { cancelContract, type CancelState } from "./actions";

const initial: CancelState = { error: "" };

/**
 * Cancelling from the contract link: the electronic way to send the notice of
 * cancellation (the right-to-cancel notice allows emailing it). The printed
 * Notice of Cancellation forms on the contract still work too.
 */
export function ContractCancel({ token, deadlineLabel, businessName }: { token: string; deadlineLabel: string; businessName: string }) {
  const [state, action, pending] = useActionState(cancelContract.bind(null, token), initial);
  if (state.cancelled) {
    return (
      <p role="status" className="text-sm leading-6">
        You cancelled this contract. {businessName} has been told and must return anything you paid within 10 days.
      </p>
    );
  }
  return (
    <details className="rounded-control border border-line">
      <summary className="tap-target flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold">Cancel this contract</summary>
      <form action={action} className="space-y-3 border-t border-line p-4">
        <p className="text-sm leading-6 text-ink-muted">
          You can cancel until midnight on {deadlineLabel || "the last day of your cancellation period"}, without any penalty. Anything you paid is returned within 10 days.
        </p>
        <label className="block text-sm font-medium">
          Anything you want to tell {businessName} (optional)
          <textarea
            name="note"
            maxLength={1000}
            rows={3}
            className="mt-1 block w-full rounded-control border border-line bg-surface px-3 py-2 text-base text-ink"
          />
        </label>
        <label className="tap-target flex min-h-12 items-center gap-2 text-sm">
          <input type="checkbox" name="confirm" required className="h-4 w-4" />I want to cancel this contract.
        </label>
        <button
          type="submit"
          disabled={pending}
          className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-critical px-4 text-sm font-semibold text-critical disabled:opacity-60 sm:w-auto"
        >
          {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
          Cancel the contract
        </button>
        {state.error ? <p className="text-sm text-critical">{state.error}</p> : null}
      </form>
    </details>
  );
}
