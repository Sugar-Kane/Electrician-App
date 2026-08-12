"use client";

import { useActionState, useRef, useState } from "react";
import Link from "next/link";
import {
  CheckCircle2,
  ChevronRight,
  Clock3,
  LoaderCircle,
  ReceiptText,
  Trash2,
  TriangleAlert,
} from "lucide-react";

import { deleteInvoice, type InvoiceActionState } from "@/app/invoices/actions";
import { InvoiceSend } from "@/components/invoice-send";
import { swipeIntent } from "@/lib/swipe";
import type { PilotInvoice } from "@/lib/pilot-data";

/**
 * One invoice in the list, and the swipe that removes it.
 *
 * The swipe is a phone gesture and it is not the only way in: the row also has
 * a delete button that appears when it is pulled open, and the same button is
 * reachable with a keyboard. A gesture nobody can discover and nobody can
 * operate with a keyboard would be a feature for exactly one kind of user.
 *
 * Nothing is deleted by the swipe itself. Pulling the row open reveals a
 * button; the button asks; the confirmation deletes. An invoice removed by a
 * pocket-swipe would be a record of money gone with no undo.
 */

const STATUS_STYLES: Record<string, string> = {
  Paid: "bg-positive-bg text-positive",
  Unpaid: "bg-info-bg text-info",
  Overdue: "bg-critical-bg text-critical",
};

const STATUS_ICONS: Record<string, typeof CheckCircle2> = {
  Paid: CheckCircle2,
  Unpaid: Clock3,
  Overdue: TriangleAlert,
};

const initialState: InvoiceActionState = { error: "" };

export function InvoiceRow({ invoice }: { invoice: PilotInvoice }) {
  const [state, remove, removing] = useActionState(deleteInvoice, initialState);
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);

  const Icon = STATUS_ICONS[invoice.status] ?? ReceiptText;
  // The demo fixtures have no database row, so there is nothing to delete and
  // the gesture is not offered on them.
  const deletable = Boolean(invoice.recordId);

  function onTouchStart(event: React.TouchEvent) {
    const touch = event.touches[0];
    start.current = touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  function onTouchMove(event: React.TouchEvent) {
    if (!deletable) return;
    const touch = event.touches[0];
    const intent = swipeIntent(
      start.current,
      touch ? { x: touch.clientX, y: touch.clientY } : null,
    );

    if (intent === "open") setOpen(true);
    if (intent === "close") setOpen(false);
  }

  if (confirming) {
    return (
      <div className="rounded-control border border-critical/30 bg-critical-bg p-4">
        <h3 className="text-sm font-semibold">Delete invoice {invoice.id}?</h3>
        <p className="mt-1 text-sm leading-6 text-ink-muted">
          {invoice.customer} ·{" "}
          {invoice.amount.toLocaleString("en-US", { style: "currency", currency: "USD" })}. This
          cannot be undone, and the PDF goes with it.
        </p>

        {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <form action={remove}>
            <input type="hidden" name="invoiceId" value={invoice.recordId ?? ""} />
            <button
              type="submit"
              disabled={removing}
              className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-critical/40 bg-critical/15 px-4 text-sm font-semibold text-critical disabled:opacity-60"
            >
              {removing ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
              {removing ? "Deleting…" : "Delete invoice"}
            </button>
          </form>
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              setOpen(false);
            }}
            disabled={removing}
            className="tap-target inline-flex min-h-12 items-center justify-center rounded-control border border-line px-4 text-sm font-semibold"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-control border border-line px-4 py-3">
      <div className="flex items-center gap-2" onTouchStart={onTouchStart} onTouchMove={onTouchMove}>
        <Link
          href={invoice.recordId ? `/invoices/${invoice.recordId}` : `/jobs/${invoice.jobId}`}
          className="tap-row flex min-h-[52px] min-w-0 flex-1 items-center gap-3 active:bg-white/5"
        >
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5">
            <Icon className="h-5 w-5 text-brand" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold">{invoice.customer}</span>
            <span className="mt-0.5 block truncate text-xs text-ink-muted">
              {invoice.id} · due {invoice.due}
              {invoice.sentLabel ? ` · sent ${invoice.sentLabel}` : ""}
            </span>
          </span>
          <span className="shrink-0 text-right">
            <span className="block text-sm font-semibold">
              ${invoice.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
            </span>
            <span
              className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${STATUS_STYLES[invoice.status] ?? ""}`}
            >
              {invoice.status}
            </span>
          </span>
          {open ? null : <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />}
        </Link>

        {open && deletable ? (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            aria-label={`Delete invoice ${invoice.id}`}
            className="tap-target grid h-12 w-12 shrink-0 place-items-center rounded-control border border-critical/40 bg-critical/15 text-critical"
          >
            <Trash2 className="h-5 w-5" aria-hidden />
          </button>
        ) : null}
      </div>

      {/*
        The keyboard and screen-reader route to the same thing. Visible only
        once the row is focused within, so it does not add a second control to
        every row for people who have the gesture.
      */}
      {deletable && !open ? (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="sr-only focus:not-sr-only focus:mt-2 focus:inline-flex focus:min-h-11 focus:items-center focus:gap-2 focus:rounded-control focus:border focus:border-critical/40 focus:px-3 focus:text-sm focus:font-semibold focus:text-critical"
        >
          <Trash2 className="h-4 w-4" aria-hidden />
          Delete invoice {invoice.id}
        </button>
      ) : null}

      {state.error && !confirming ? (
        <p className="mt-2 text-sm text-critical">{state.error}</p>
      ) : null}

      {invoice.status === "Paid" ? null : <InvoiceSend invoice={invoice} />}
    </div>
  );
}
