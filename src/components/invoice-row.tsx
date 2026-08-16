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
 * Swipe left, the delete button appears, tapping it deletes. There is no
 * confirmation step: the swipe is the deliberate act, and asking twice for
 * something the gesture already gated turned a two-tap job into four.
 *
 * What survives instead is the part that cannot be undone by hand. A paid
 * invoice is refused by the server whatever this screen does — money received
 * does not get swiped away — and the button only exists on rows that have a
 * real record behind them.
 *
 * The gesture is not the only way in: the same button is reachable with a
 * keyboard. A control nobody can discover and nobody can operate without a
 * touchscreen would be a feature for exactly one kind of user.
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
          <form action={remove}>
            <input type="hidden" name="invoiceId" value={invoice.recordId ?? ""} />
            <button
              type="submit"
              disabled={removing}
              aria-label={`Delete invoice ${invoice.id}`}
              className="tap-target grid h-12 w-12 shrink-0 place-items-center rounded-control border border-critical/40 bg-critical/15 text-critical disabled:opacity-60"
            >
              {removing ? (
                <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden />
              ) : (
                <Trash2 className="h-5 w-5" aria-hidden />
              )}
            </button>
          </form>
        ) : null}
      </div>

      {/*
        The keyboard and screen-reader route to the same thing. Visible only
        once the row is focused within, so it does not add a second control to
        every row for people who have the gesture.
      */}
      {deletable && !open ? (
        <form action={remove}>
          <input type="hidden" name="invoiceId" value={invoice.recordId ?? ""} />
          <button
            type="submit"
            disabled={removing}
            className="sr-only focus:not-sr-only focus:mt-2 focus:inline-flex focus:min-h-11 focus:items-center focus:gap-2 focus:rounded-control focus:border focus:border-critical/40 focus:px-3 focus:text-sm focus:font-semibold focus:text-critical"
          >
            <Trash2 className="h-4 w-4" aria-hidden />
            Delete invoice {invoice.id}
          </button>
        </form>
      ) : null}

      {state.error ? <p className="mt-2 text-sm text-critical">{state.error}</p> : null}

      {invoice.status === "Paid" ? null : <InvoiceSend invoice={invoice} />}
    </div>
  );
}
