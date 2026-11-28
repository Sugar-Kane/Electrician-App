"use client";

import { useActionState, useState, useTransition } from "react";
import { CheckCircle2, CreditCard, Send } from "lucide-react";

import {
  collectDiagnosticAction,
  completeDiagnosticAction,
  sendDiagnosticLinkAction,
  type DiagnosticPaymentActionState,
} from "@/app/jobs/[jobId]/diagnostic-payment-actions";
import { Button } from "@/components/ui/button";
import { Field, FormMessage } from "@/components/ui/field";
import { SelectField } from "@/components/ui/select-field";

const OUTCOMES = [
  { value: "diagnostic_only", label: "Diagnostic only — customer declined repairs", description: "Standalone diagnostic: the authorized fee is collected." },
  { value: "fix_now", label: "Fixed on this visit — same contract", description: "The fee is billed with the repair on the final invoice when that work is complete." },
  { value: "schedule_later", label: "Repair needed — schedule a work order", description: "Collected now only if the repair is a separate contract the customer signs later." },
] as const;

/** Complete a diagnostic and collect its authorized payment, on the job screen. */
export function DiagnosticPaymentControls({
  jobNumber,
  completed,
  canCollect,
  collectReason,
  linkKind,
}: {
  jobNumber: string;
  completed: boolean;
  canCollect: boolean;
  collectReason: string | null;
  linkKind: "setup" | "recovery" | null;
}) {
  const [completeState, completeAction] = useActionState<DiagnosticPaymentActionState, FormData>(
    completeDiagnosticAction.bind(null, jobNumber),
    { error: "" },
  );
  const [outcome, setOutcome] = useState("diagnostic_only");
  const [result, setResult] = useState<DiagnosticPaymentActionState>({ error: "" });
  const [pending, start] = useTransition();

  return (
    <div className="mt-4 space-y-4">
      {!completed ? (
        <form action={completeAction} className="space-y-3 rounded-control border border-line bg-raised p-4">
          <Field label="How did the diagnostic end?" group>
            <SelectField name="outcome" label="Outcome" value={outcome} onChange={setOutcome} choices={OUTCOMES} />
          </Field>
          <Field label="Diagnostic findings" hint="Required before any payment is collected. What you found and what you did.">
            <textarea
              name="findings"
              rows={3}
              required
              minLength={15}
              maxLength={4000}
              className="w-full resize-y rounded-control border border-line bg-surface p-3 text-base text-ink outline-none focus:border-brand/70"
            />
          </Field>
          {outcome === "schedule_later" ? (
            <label className="tap-target flex cursor-pointer items-start gap-3">
              <input type="checkbox" name="separateContract" className="mt-1 h-5 w-5 shrink-0 accent-brand" />
              <span className="text-sm leading-6 text-ink-muted">
                The repair will be a separate, new contract the customer signs later. Leave unticked if it is part of this diagnostic&apos;s contract; the fee then waits for that work to be complete.
              </span>
            </label>
          ) : null}
          <Button type="submit">
            <CheckCircle2 className="h-4 w-4" aria-hidden /> Complete diagnostic
          </Button>
          <FormMessage error={completeState.error} notice={completeState.notice} />
        </form>
      ) : null}

      <div className="flex flex-wrap gap-2">
        {canCollect ? (
          <Button
            type="button"
            disabled={pending}
            onClick={() => start(async () => setResult(await collectDiagnosticAction(jobNumber)))}
          >
            <CreditCard className="h-4 w-4" aria-hidden /> Collect authorized payment
          </Button>
        ) : null}
        {linkKind ? (
          <Button
            type="button"
            variant="secondary"
            disabled={pending}
            onClick={() => start(async () => setResult(await sendDiagnosticLinkAction(jobNumber, linkKind)))}
          >
            <Send className="h-4 w-4" aria-hidden /> {linkKind === "setup" ? "Send setup link" : "Send secure payment link"}
          </Button>
        ) : null}
      </div>
      {!canCollect && completed && collectReason ? <p className="text-sm leading-6 text-ink-muted">{collectReason}</p> : null}
      <FormMessage error={result.error} notice={result.notice} />
    </div>
  );
}
