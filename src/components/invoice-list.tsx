"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign } from "lucide-react";

import { InvoiceRow } from "@/components/invoice-row";
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
        {/*
          Each row owns its own delete gesture and confirmation. Keeping that
          here would have meant one open-row and one confirming-row state for
          the whole list, which is how a confirmation ends up over the wrong
          invoice after a filter change.
        */}
        {visible.map((invoice) => (
          <InvoiceRow key={invoice.id} invoice={invoice} />
        ))}

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
