"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDollarSign, Undo2, X } from "lucide-react";

import { onTabListKeyDown } from "@/components/ui/keyboard";
import { InvoiceRow } from "@/components/invoice-row";
import {
  inInvoiceFilter,
  listedTotalCents,
  paidInPeriod,
  type InvoiceFilter,
  type PaidPeriod,
} from "@/lib/dashboard-metrics";
import type { DiagnosticPayment, ListedRefund } from "@/lib/job-data";
import type { PilotInvoice } from "@/lib/pilot-data";

/**
 * Invoices, filtered in the browser.
 *
 * Each tab used to be a link to `/invoices?status=…`, so switching from Paid to
 * Unpaid was a full server round trip — which re-fetched every invoice and then
 * filtered them in memory anyway. The server did identical work for all four
 * tabs, and the wait was the network rather than the query.
 *
 * The list is small by nature (one crew's invoices), so it is fetched once and
 * filtered here. Switching tabs is now instant because nothing has to happen.
 */

/*
 * By state, so a draft nobody has sent is never under the same tab as money
 * the customer has been asked for. "unpaid" is still accepted from older links
 * and lands on Awaiting, which is what it always meant. Which states each tab
 * holds, and what it adds up to, is `inInvoiceFilter` and `listedTotalCents`:
 * the same rule Today's money figures use, so a number and the list it opens
 * agree.
 */
const FILTERS: { label: string; value: InvoiceFilter }[] = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "draft" },
  { label: "Awaiting", value: "awaiting" },
  { label: "Overdue", value: "overdue" },
  { label: "Paid", value: "paid" },
  { label: "Refunded", value: "refunded" },
];

const PERIOD_LABELS: Record<PaidPeriod, string> = {
  today: "Paid today",
  month: "Paid this month",
};

const cents = (dollars: number | undefined) => Math.round((dollars ?? 0) * 100);

export function InvoiceList({
  invoices,
  diagnosticPayments = [],
  refunds = [],
  initialStatus,
  paidPeriod = null,
  today = "",
}: {
  invoices: PilotInvoice[];
  /**
   * Diagnostic fees paid online at booking. No invoice carries them (the later
   * invoice credits them), so they are listed beside the invoices on Paid and
   * All, and counted in that total, the same as Today's "Paid today".
   */
  diagnosticPayments?: DiagnosticPayment[];
  /**
   * Money given back, from invoices and diagnostic fees. All of it is under
   * Refunded; on Paid and All, what went through is listed on the day it went
   * back and taken off the total, the same as Today's figure does.
   */
  refunds?: ListedRefund[];
  initialStatus: string;
  /** Narrows Paid to what was paid today or this month, from `?paid=`. */
  paidPeriod?: PaidPeriod | null;
  /** The business's today, YYYY-MM-DD, for `paidPeriod`. */
  today?: string;
}) {
  const asked = initialStatus === "unpaid" ? "awaiting" : initialStatus;
  const [status, setStatus] = useState<InvoiceFilter>(
    FILTERS.find((filter) => filter.value === asked)?.value ?? "all",
  );
  // Kept until it is cleared or another tab is chosen, so it never quietly
  // narrows a tab it was not asked for.
  const [period, setPeriod] = useState<PaidPeriod | null>(asked === "paid" ? paidPeriod : null);

  const visible = useMemo(
    () =>
      invoices.filter(
        (invoice) =>
          inInvoiceFilter(invoice.state, status) &&
          (status !== "paid" || !period || paidInPeriod(invoice.paidOn, period, today)),
      ),
    [invoices, status, period, today],
  );
  const visiblePayments = useMemo(
    () =>
      status === "all" || status === "paid"
        ? diagnosticPayments.filter(
            (payment) => status !== "paid" || !period || paidInPeriod(payment.paidOn, period, today),
          )
        : [],
    [diagnosticPayments, status, period, today],
  );
  const visibleRefunds = useMemo(() => {
    if (status === "refunded") return refunds;
    if (status !== "all" && status !== "paid") return [];
    return refunds.filter(
      (refund) => refund.settled && (status !== "paid" || !period || paidInPeriod(refund.refundedOn, period, today)),
    );
  }, [refunds, status, period, today]);
  // Only money that has gone back counts; one still on its way is listed.
  const refundedTotal = visibleRefunds
    .filter((refund) => refund.settled)
    .reduce((sum, refund) => sum + refund.amount, 0);
  // On All, drafts are part of what is listed but not of what is owed, so
  // the total says how much of it has not been sent.
  const draftTotal =
    status === "all"
      ? visible.filter((invoice) => invoice.state === "draft").reduce((sum, invoice) => sum + invoice.amount, 0)
      : 0;

  // Awaiting and Overdue add up what is still owed, which is what Today's
  // "owed" says; the others add up the invoice totals.
  const owing = status === "awaiting" || status === "overdue";
  const total =
    status === "refunded"
      ? refundedTotal
      : listedTotalCents(
      visible.map((invoice) => ({
        state: invoice.state,
        totalCents: cents(invoice.amount),
        balanceCents: cents(invoice.balance ?? invoice.amount),
      })),
      status,
    ) /
      100 +
        visiblePayments.reduce((sum, payment) => sum + payment.amount, 0) -
        refundedTotal;

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <div
        // Two rows of three on a phone rather than six squeezed tabs that
        // break "Awaiting" in half.
        className="grid grid-cols-3 gap-1 min-[560px]:grid-cols-6"
        role="tablist"
        aria-label="Filter invoices by status"
        onKeyDown={onTabListKeyDown}
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            role="tab"
            aria-selected={status === filter.value}
            onClick={() => {
              setStatus(filter.value);
              setPeriod(null);
            }}
            className={`tap-target flex min-h-11 items-center justify-center whitespace-nowrap rounded-chip px-2 text-xs font-semibold transition ${
              status === filter.value
                ? "bg-brand text-on-brand"
                : "border border-line text-ink-muted hover:text-ink"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      {period && status === "paid" ? (
        <p className="mt-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{PERIOD_LABELS[period]}</span>
          <button
            type="button"
            onClick={() => setPeriod(null)}
            className="tap-target inline-flex min-h-11 items-center gap-1 rounded-chip border border-line px-3 text-xs font-semibold text-ink-muted hover:text-ink"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
            Show all paid
          </button>
        </p>
      ) : null}

      <div className="mt-5 flex items-end justify-between rounded-control bg-white/[0.035] p-4">
        <div>
          <p className="text-xs text-ink-muted">{owing ? "Still owed" : status === "refunded" ? "Refunded" : "Visible total"}</p>
          <p className="mt-1 text-3xl font-semibold">
            ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
          {draftTotal > 0 ? (
            <p className="mt-1 text-xs text-ink-muted">
              Includes ${draftTotal.toLocaleString("en-US", { minimumFractionDigits: 2 })} in drafts not sent
            </p>
          ) : null}
        </div>
        <CircleDollarSign className="h-7 w-7 text-brand" aria-hidden />
      </div>

      <div className="mt-4 space-y-2">
        {/*
          Each row owns its own delete gesture and confirmation. Keeping that
          here would have meant one open-row and one confirming-row state for
          the whole list, which is how a confirmation ends up over the wrong
          invoice after a filter change.
        */}
        {visible.map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice} />
        ))}

        {visiblePayments.map((payment) => (
          <Link
            key={payment.id}
            href={`/jobs/${payment.jobId}`}
            className="tap-row flex min-h-[52px] items-center gap-3 rounded-control border border-line px-4 py-3 active:bg-white/5"
          >
            <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5 min-[360px]:grid">
              <CheckCircle2 className="h-5 w-5 text-brand" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{payment.customer}</span>
                <span className="shrink-0 text-sm font-semibold">
                  ${payment.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </span>
              <span className="mt-0.5 block break-words text-xs leading-5 text-ink-muted">
                Diagnostic fee · paid online {payment.paidLabel}
              </span>
              <span className="mt-1 inline-block rounded-full bg-positive-bg px-2 py-0.5 text-[10px] font-semibold text-positive">
                Paid
              </span>
              {payment.refunded > 0 ? (
                <span className="ml-1 mt-1 inline-block rounded-full bg-white/[0.08] px-2 py-0.5 text-[10px] font-semibold text-ink-muted">
                  {payment.refunded >= payment.amount
                    ? "Refunded"
                    : `$${payment.refunded.toLocaleString("en-US", { minimumFractionDigits: 2 })} refunded`}
                </span>
              ) : null}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          </Link>
        ))}

        {visibleRefunds.map((refund) => (
          <Link
            key={refund.id}
            href={refund.href}
            className="tap-row flex min-h-[52px] items-center gap-3 rounded-control border border-line px-4 py-3 active:bg-white/5"
          >
            <span className="hidden h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5 min-[360px]:grid">
              <Undo2 className="h-5 w-5 text-ink-muted" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-semibold">{refund.customer}</span>
                <span className="shrink-0 text-sm font-semibold">
                  −${refund.amount.toLocaleString("en-US", { minimumFractionDigits: 2 })}
                </span>
              </span>
              <span className="mt-0.5 block break-words text-xs leading-5 text-ink-muted">
                {refund.what} · {refund.settled ? refund.refundedLabel : `started ${refund.refundedLabel}`}
              </span>
              <span
                className={`mt-1 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  refund.settled ? "bg-white/[0.08] text-ink-muted" : "bg-info-bg text-info"
                }`}
              >
                {refund.settled ? "Refunded" : "Refund on its way"}
              </span>
            </span>
            <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
          </Link>
        ))}

        {visible.length === 0 && visiblePayments.length === 0 && visibleRefunds.length === 0 ? (
          <p className="rounded-control border border-dashed border-line p-8 text-center text-sm text-ink-muted">
            {status === "refunded"
              ? "No refunds yet."
              : invoices.length === 0 && diagnosticPayments.length === 0
              ? "No invoices yet. They appear here once a job is invoiced."
              : period && status === "paid"
                ? `Nothing ${PERIOD_LABELS[period].toLowerCase()}.`
                : `No ${status} invoices.`}
          </p>
        ) : null}
      </div>
    </section>
  );
}
