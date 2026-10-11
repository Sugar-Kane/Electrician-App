"use client";

import { useMemo, useState } from "react";
import { CircleDollarSign } from "lucide-react";

import { InvoiceRow } from "@/components/invoice-row";
import type { InvoiceState } from "@/lib/dashboard-metrics";
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
 * and lands on Awaiting, which is what it always meant.
 */
const FILTERS = [
  { label: "All", value: "all" },
  { label: "Drafts", value: "draft" },
  { label: "Awaiting", value: "awaiting" },
  { label: "Overdue", value: "overdue" },
  { label: "Paid", value: "paid" },
] as const;

const IN_FILTER: Record<string, (state: InvoiceState) => boolean> = {
  draft: (state) => state === "draft",
  awaiting: (state) => state === "awaiting" || state === "part_paid",
  overdue: (state) => state === "overdue",
  paid: (state) => state === "paid",
};

export function InvoiceList({
  invoices,
  initialStatus,
}: {
  invoices: PilotInvoice[];
  initialStatus: string;
}) {
  const asked = initialStatus === "unpaid" ? "awaiting" : initialStatus;
  const [status, setStatus] = useState<string>(
    FILTERS.some((filter) => filter.value === asked) ? asked : "all",
  );

  const visible = useMemo(
    () =>
      status === "all"
        ? invoices
        : invoices.filter((invoice) => IN_FILTER[status]?.(invoice.state) ?? true),
    [invoices, status],
  );
  // On All, drafts are part of what is listed but not of what is owed, so
  // the total says how much of it has not been sent.
  const draftTotal =
    status === "all"
      ? visible.filter((invoice) => invoice.state === "draft").reduce((sum, invoice) => sum + invoice.amount, 0)
      : 0;

  const total = visible.reduce((sum, invoice) => sum + invoice.amount, 0);

  return (
    <section className="rounded-panel border border-line bg-surface p-4 sm:p-6">
      <div
        // Two rows on a narrow phone rather than five squeezed tabs that
        // break "Awaiting" in half.
        className="grid grid-cols-3 gap-1 min-[440px]:grid-cols-5"
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

      <div className="mt-5 flex items-end justify-between rounded-control bg-white/[0.035] p-4">
        <div>
          <p className="text-xs text-ink-muted">Visible total</p>
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
