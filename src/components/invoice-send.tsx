"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { LoaderCircle, Mail, MessageSquare, Send, X } from "lucide-react";

import { sendInvoice, type InvoiceActionState } from "@/app/invoices/actions";
import type { PilotInvoice } from "@/lib/pilot-data";

/**
 * Sending one invoice.
 *
 * Opens a small panel rather than sending on the first tap: which channel to
 * use is a real decision — a customer who gave only an email cannot be texted,
 * and texting somebody a bill they have already been emailed is how a business
 * reads as disorganised.
 *
 * Channels the customer has no contact detail for are disabled rather than
 * hidden, with the reason next to them, because "why can I not text this
 * customer" is answered by "there is no mobile number on their record" and not
 * by a missing control.
 */

const initialState: InvoiceActionState = { error: "" };

function SubmitButton({ disabled }: { disabled: boolean }) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending || disabled}
      className="tap-target inline-flex items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-semibold text-on-brand disabled:opacity-50"
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
      ) : (
        <Send className="h-4 w-4" aria-hidden />
      )}
      {pending ? "Sending" : "Send invoice"}
    </button>
  );
}

export function InvoiceSend({ invoice }: { invoice: PilotInvoice }) {
  const [state, action] = useActionState(sendInvoice, initialState);

  const hasPhone = Boolean(invoice.customerPhone);
  const hasEmail = Boolean(invoice.customerEmail);

  const [sms, setSms] = useState(hasPhone);
  const [email, setEmail] = useState(hasEmail);

  const [openRequested, setOpenRequested] = useState(false);
  /** The action result that was current when the panel was last opened. */
  const [seenState, setSeenState] = useState(initialState);

  /*
   * Whether the panel is open is a value, not an event to react to.
   *
   * It closes on a completed send, so the row goes back to showing "sent"
   * rather than leaving one open and inviting a second send of the same bill.
   * That used to be an effect setting state, which is a render spent undoing
   * the render before it.
   *
   * Compared by identity rather than by the notice text: two sends of the same
   * invoice produce the same words, so remembering the string would leave the
   * panel open on the second one. `useActionState` returns a fresh object per
   * run, which is what actually distinguishes "this result is new".
   *
   * Only a success closes it. An error keeps it open, because the error renders
   * inside the panel and closing would take the message with it.
   */
  const settled = state !== seenState && Boolean(state.notice);
  const open = openRequested && !settled;

  if (!invoice.recordId) return null;

  return (
    <div className="mt-2">
      {state.notice ? (
        <p className="mb-2 rounded-control border border-positive/25 bg-positive-bg px-3 py-2 text-xs text-positive">
          {state.notice}
        </p>
      ) : null}

      {!open ? (
        <button
          type="button"
          onClick={() => {
            setOpenRequested(true);
            setSeenState(state);
          }}
          className="tap-target inline-flex items-center gap-2 rounded-control border border-line px-3 text-xs font-semibold text-ink-muted hover:text-ink"
        >
          <Send className="h-3.5 w-3.5" aria-hidden />
          {invoice.sentLabel ? "Send again" : "Send to customer"}
        </button>
      ) : (
        <form action={action} className="rounded-control border border-line bg-raised p-3">
          <input type="hidden" name="invoiceId" value={invoice.recordId} />

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">Send {invoice.id}</p>
            <button
              type="button"
              onClick={() => setOpenRequested(false)}
              aria-label="Close"
              className="tap-target grid h-8 w-8 place-items-center rounded-control text-ink-faint hover:text-ink"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>

          <label className="mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              name="sendSms"
              checked={sms}
              disabled={!hasPhone}
              onChange={(event) => setSms(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span className={hasPhone ? "" : "text-ink-faint"}>
              <MessageSquare className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              {hasPhone ? `Text ${invoice.customerPhone}` : "No mobile number on this customer"}
            </span>
          </label>

          <label className="mt-2 flex items-start gap-2 text-xs">
            <input
              type="checkbox"
              name="sendEmail"
              checked={email}
              disabled={!hasEmail}
              onChange={(event) => setEmail(event.target.checked)}
              className="mt-0.5 h-4 w-4 accent-[var(--color-brand)]"
            />
            <span className={hasEmail ? "" : "text-ink-faint"}>
              <Mail className="mr-1 inline h-3.5 w-3.5" aria-hidden />
              {hasEmail ? `Email ${invoice.customerEmail}` : "No email address on this customer"}
            </span>
          </label>

          {state.error ? (
            <p className="mt-2 text-xs text-critical">{state.error}</p>
          ) : null}

          <div className="mt-3">
            <SubmitButton disabled={!sms && !email} />
          </div>
        </form>
      )}
    </div>
  );
}
