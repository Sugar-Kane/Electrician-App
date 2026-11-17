"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import { declineChangeOrder, type DeclineState } from "@/app/contract/[token]/actions";
import { inputClass } from "@/components/ui/field";

/**
 * Turning a change order down, beside signing it.
 *
 * Two steps, so a stray tap does not decline: open, then confirm. Nothing on
 * the job changes; the business is told, with the reason if one is given.
 */
export function ChangeOrderDecline({ token }: { token: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, decline, pending] = useActionState(
    (previous: DeclineState, form: FormData) => declineChangeOrder(token, previous, form),
    { error: "" } as DeclineState,
  );
  useEffect(() => {
    if (state.declined) router.refresh();
  }, [state.declined, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="tap-target mt-4 inline-flex min-h-12 w-full items-center justify-center rounded-control border border-line px-4 text-sm font-semibold sm:w-auto"
      >
        Decline this change order
      </button>
    );
  }

  return (
    <form action={decline} className="mt-4 space-y-3 rounded-control border border-line p-4">
      <p className="text-sm font-semibold">Decline the change order?</p>
      <p className="text-sm text-ink-muted">Nothing changes on your job: the work and price you already agreed stay as they are.</p>
      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">Anything you want to tell them (optional)</span>
        <input name="reason" maxLength={1000} className={`mt-1 ${inputClass}`} />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <button
          type="submit"
          disabled={pending}
          className="tap-target min-h-12 rounded-control bg-white/10 px-4 text-sm font-semibold disabled:opacity-60"
        >
          {pending ? "Declining…" : "Decline"}
        </button>
        <button type="button" onClick={() => setOpen(false)} className="tap-target min-h-12 rounded-control border border-line px-4 text-sm font-semibold">
          Back
        </button>
      </div>
      {state.error ? <p className="text-sm text-critical">{state.error}</p> : null}
    </form>
  );
}
