"use client";

import { useActionState } from "react";
import { LoaderCircle, MessageSquareText } from "lucide-react";

import { recordStopTextsRequest, type StopTextsState } from "@/app/customers/[customerId]/actions";
import { FormMessage } from "@/components/ui/field";

/**
 * Whether texts reach this customer, in one line beside "Messages in", and the
 * way to record that they asked to stop some way other than a text.
 *
 * A customer may ask to stop by any reasonable means (FCC revocation rule):
 * a phone call, at the door, in a letter or an email counts as much as a STOP
 * reply. Recording it is one step any team member can take; undoing it is not
 * possible in the app. Only the customer can turn texts back on, by texting
 * START.
 */

export type TextConsentStatus = { state: "on" } | { state: "stopped"; label: string };

const WAYS = [
  { value: "verbal", label: "Phone or in person" },
  { value: "email", label: "Email" },
  { value: "written", label: "Letter or note" },
] as const;

const initialState: StopTextsState = { error: "" };

export function CustomerTextConsent({
  customerId,
  hasPhone,
  status,
}: {
  customerId: string;
  hasPhone: boolean;
  status: TextConsentStatus;
}) {
  const [state, action, pending] = useActionState(recordStopTextsRequest, initialState);
  if (!hasPhone) return null;
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h3 className="flex items-center gap-2 text-sm font-semibold">
        <MessageSquareText className="h-4 w-4 text-ink-faint" aria-hidden />
        Texts
      </h3>
      {status.state === "stopped" ? (
        <p className="mt-2 text-sm">
          <span className="font-semibold text-caution">Asked to stop texts</span>
          <span className="text-ink-muted"> · {status.label}. No texts go to them until they text START.</span>
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-ink-muted">On. Updates, invoices and links are texted to this number.</p>
          <details className="mt-3 rounded-control border border-line">
            <summary className="tap-target flex min-h-12 cursor-pointer items-center px-4 text-sm font-semibold">
              Customer asked to stop texts
            </summary>
            <form action={action} className="space-y-3 border-t border-line p-4">
              <input type="hidden" name="customerId" value={customerId} />
              <fieldset>
                <legend className="text-sm font-medium">How did they ask?</legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                  {WAYS.map((way, index) => (
                    <label
                      key={way.value}
                      className="tap-target flex min-h-12 items-center gap-2 rounded-control border border-line px-3 text-sm"
                    >
                      <input type="radio" name="way" value={way.value} defaultChecked={index === 0} className="h-4 w-4" />
                      {way.label}
                    </label>
                  ))}
                </div>
              </fieldset>
              <label className="block text-sm font-medium">
                What they said (optional)
                <input
                  name="note"
                  maxLength={300}
                  className="mt-1 block min-h-12 w-full rounded-control border border-line bg-surface px-3 text-base"
                  placeholder="e.g. Said on the phone to call instead of texting"
                />
              </label>
              <p className="text-sm text-ink-muted">
                Texts stop right away. Only the customer can turn them back on, by texting START.
              </p>
              <button
                type="submit"
                disabled={pending}
                className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-caution px-4 text-sm font-semibold text-caution disabled:opacity-60 sm:w-auto"
              >
                {pending ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
                Stop texting this customer
              </button>
            </form>
          </details>
        </>
      )}
      <FormMessage error={state.error} notice={state.notice} />
    </div>
  );
}
