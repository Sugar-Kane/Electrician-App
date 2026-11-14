"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { FileText, LoaderCircle } from "lucide-react";

import { sendEstimateAction, type SendEstimateState } from "@/app/jobs/[jobId]/estimate-send-actions";
import { formatCents } from "@/lib/job-lines";

/**
 * On the Estimate card, once the job has priced lines: send the customer the
 * total they will pay, by text, email or both. Nothing for them to sign.
 */

const initial: SendEstimateState = { error: "" };

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-3 text-sm font-semibold text-on-brand disabled:opacity-60"
    >
      {pending ? <LoaderCircle className="h-4 w-4 shrink-0 animate-spin" aria-hidden /> : <FileText className="h-4 w-4 shrink-0" aria-hidden />}
      {pending ? "Sending estimate…" : label}
    </button>
  );
}

export function SendEstimate({
  jobNumber,
  totalCents,
  hasPhone,
  hasEmail,
  lastSentLabel,
}: {
  jobNumber: string;
  /** What the job's lines come to, which is what the estimate will say. */
  totalCents: number;
  hasPhone: boolean;
  hasEmail: boolean;
  /** "EST-4 · $1,040.00 · Nov 13", when one has gone out. */
  lastSentLabel?: string;
}) {
  const [state, action] = useActionState(sendEstimateAction, initial);
  if (totalCents <= 0) return null;

  return (
    <form action={action} className="mt-4 border-t border-line pt-4">
      <input type="hidden" name="jobNumber" value={jobNumber} />
      <p className="mb-2 text-xs leading-5 text-ink-muted">
        Send the customer the total for this work. It looks like the invoice, with nothing to sign and nothing due.
      </p>
      <div className="mb-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" name="sendSms" defaultChecked={hasPhone} disabled={!hasPhone} className="h-4 w-4" />
          Text{hasPhone ? "" : " (no phone)"}
        </label>
        <label className="inline-flex min-h-11 items-center gap-2">
          <input type="checkbox" name="sendEmail" defaultChecked={hasEmail} disabled={!hasEmail} className="h-4 w-4" />
          Email{hasEmail ? "" : " (no email)"}
        </label>
      </div>
      <Submit label={`${lastSentLabel ? "Send updated estimate" : "Send estimate"} · ${formatCents(totalCents)}`} />
      {lastSentLabel ? <p className="mt-2 text-xs text-ink-muted">Last sent: {lastSentLabel}.</p> : null}
      {state.error ? <p className="mt-2 text-xs text-critical">{state.error}</p> : null}
      {state.notice ? (
        <p className="mt-2 text-xs text-positive" role="status">
          {state.notice}
        </p>
      ) : null}
    </form>
  );
}
