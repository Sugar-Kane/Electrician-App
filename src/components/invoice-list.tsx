"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { CheckCircle2, ChevronRight, CircleDollarSign, Clock3, ReceiptText, TriangleAlert } from "lucide-react";

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

const FILTERS = [
  { label: "All", value: "all" },
  { label: "Paid", value: "paid" },
  { label: "Unpaid", value: "unpaid" },
  { label: "Overdue", value: "overdue" },
] as const;

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

export function InvoiceList({
  invoices,
  initialStatus,
}: {
  invoices: PilotInvoice[];
  initialStatus: string;
}) {
  const [status, setStatus] = useState(
    FILTERS.some((filter) => filter.value === initialStatus) ? initialStatus : "all",
  );

  const visible = useMemo(
    () =>
      status === "all"
        ? invoices
        : invoices.filter((invoice) => invoice.status.toLowerCase() === status),
    [invoices, status],
  );

  const total = visible.reduce((sum, invoice) => sum + invoice.amount, 0);

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <div
        className="grid grid-cols-4 gap-1.5"
        role="tablist"
        aria-label="Filter invoices by status"
      >
        {FILTERS.map((filter) => (
          <button
            key={filter.value}
            type="button"
            role="tab"
            aria-selected={status === filter.value}
            onClick={() => setStatus(filter.value)}
            className={`tap-target flex min-h-11 items-center justify-center rounded-chip text-xs font-semibold transition ${
              status === filter.value
                ? "bg-brand text-on-brand"
                : "border border-line text-ink-muted hover:text-ink"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>

      <div className="mt-5 flex items-end justify-between rounded-control bg-white/[0.035] p-4">
        <div>
          <p className="text-xs text-ink-muted">Visible total</p>
          <p className="mt-1 text-3xl font-semibold">
            ${total.toLocaleString("en-US", { minimumFractionDigits: 2 })}
          </p>
        </div>
        <CircleDollarSign className="h-7 w-7 text-brand" aria-hidden />
      </div>

      <div className="mt-4 space-y-2">
        {visible.map((invoice) => {
          const Icon = STATUS_ICONS[invoice.status] ?? ReceiptText;
          return (
            <Link
              key={invoice.id}
              href={`/jobs/${invoice.jobId}`}
              className="tap-row flex min-h-[76px] items-center gap-3 rounded-control border border-line px-4 py-3 active:bg-white/5"
            >
              <span className="grid h-11 w-11 shrink-0 place-items-center rounded-control bg-white/5">
                <Icon className="h-5 w-5 text-brand" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold">{invoice.customer}</span>
                <span className="mt-0.5 block truncate text-xs text-ink-muted">
                  {invoice.id} · due {invoice.due}
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
              <ChevronRight className="h-5 w-5 shrink-0 text-ink-faint" aria-hidden />
            </Link>
          );
        })}

        {visible.length === 0 ? (
          <p className="rounded-control border border-dashed border-line p-8 text-center text-sm text-ink-muted">
            {invoices.length === 0
              ? "No invoices yet. They appear here once a job is invoiced."
              : `No ${status} invoices.`}
          </p>
        ) : null}
      </div>
    </section>
  );
}
