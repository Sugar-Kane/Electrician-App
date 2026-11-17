"use client";

import { useActionState, useMemo, useState } from "react";
import { LoaderCircle, Percent } from "lucide-react";

import { setInvoiceDiscountAction, type InvoiceActionState } from "@/app/invoices/actions";
import { FormMessage, inputClass } from "@/components/ui/field";
import { signedCents } from "@/lib/change-order-math";
import { discountLabel, invoiceTotals, readDiscount, type DiscountChoice } from "@/lib/invoice-math";
import type { InvoiceSummary } from "@/lib/invoice-adjustments-server";
import { formatCents } from "@/lib/job-lines";

/**
 * The invoice's money, line by line, and its discount.
 *
 * The breakdown shows what the customer sees: the original work, each change
 * order the customer approved, the subtotal, the discount (only when there is
 * one), tax, payments and what is left.
 *
 * The discount is a percentage, a fixed amount, or none — one at a time. The
 * preview is worked out here with the same `invoiceTotals` the server uses,
 * so it shows exactly what saving will do; the server works it out again from
 * the stored figures and that is what is kept.
 */

const initial: InvoiceActionState = { error: "" };

function Row({ label, value, strong = false, muted = false }: { label: string; value: string; strong?: boolean; muted?: boolean }) {
  return (
    <div className={`flex items-baseline justify-between gap-3 ${strong ? "font-semibold" : ""} ${muted ? "text-ink-muted" : ""}`}>
      <dt className="min-w-0">{label}</dt>
      <dd className="shrink-0 tabular-nums">{value}</dd>
    </div>
  );
}

export function InvoiceBreakdown({ summary }: { summary: InvoiceSummary }) {
  return (
    <dl className="space-y-1 text-sm">
      {summary.changeOrders.length > 0 ? (
        <>
          <Row label="Original work" value={formatCents(summary.originalSubtotalCents)} muted />
          {summary.changeOrders.map((entry) => (
            <Row key={entry.number} label={`Change order #${entry.number}`} value={signedCents(entry.amountCents, formatCents)} muted />
          ))}
        </>
      ) : null}
      <Row label="Subtotal" value={formatCents(summary.subtotalCents)} />
      {/* No discount, no line: never "Discount $0.00". */}
      {summary.discountCents > 0 ? <Row label={summary.discountLabel} value={`−${formatCents(summary.discountCents)}`} muted /> : null}
      {summary.diagnosticCreditCents > 0 ? (
        <Row label="Diagnostic fee already paid" value={`−${formatCents(summary.diagnosticCreditCents)}`} muted />
      ) : null}
      {summary.taxCents > 0 ? <Row label="Tax" value={formatCents(summary.taxCents)} muted /> : null}
      <Row label="Total" value={formatCents(summary.totalCents)} strong />
      {summary.paidCents > 0 ? <Row label="Payments received" value={`−${formatCents(summary.paidCents)}`} muted /> : null}
      <Row label="Balance due" value={formatCents(summary.balanceDueCents)} strong />
      {summary.discountCapped ? (
        <p className="pt-1 text-xs text-caution">
          The fixed discount is larger than the work after a change order, so it is held to the work. Lower it if that was not meant.
        </p>
      ) : null}
    </dl>
  );
}

export function InvoiceDiscountForm({
  summary,
  canEdit,
  lockedBecause,
}: {
  summary: InvoiceSummary;
  /** The person may change billing. */
  canEdit: boolean;
  /** Why this invoice's discount cannot change (paid, void, collected by Stripe). Empty when it can. */
  lockedBecause: string;
}) {
  const [state, save, saving] = useActionState(setInvoiceDiscountAction, initial);
  const current: DiscountChoice = summary.discount?.type ?? "none";
  const [type, setType] = useState<DiscountChoice>(current);
  const [value, setValue] = useState(
    summary.discount?.type === "percentage"
      ? String(summary.discount.basisPoints / 100)
      : summary.discount?.type === "fixed"
        ? (summary.discount.cents / 100).toFixed(2)
        : "",
  );
  const [reason, setReason] = useState(summary.discountReason);
  const [tax, setTax] = useState((summary.taxCents / 100).toFixed(2));

  const preview = useMemo(() => {
    const read = readDiscount({ type, value, eligibleCents: summary.subtotalCents });
    if (!read.ok) return { error: read.reason, totals: null, label: "" };
    const taxText = tax.trim().replace(/[$,]/g, "");
    const taxCents = /^\d+(\.\d{1,2})?$/.test(taxText) ? Math.round(Number(taxText) * 100) : summary.taxCents;
    return {
      error: "",
      label: discountLabel(read.discount),
      totals: invoiceTotals({
        subtotalCents: summary.subtotalCents,
        discount: read.discount,
        taxCents,
        // What this invoice already takes off for the paid diagnostic.
        diagnosticPaidCents: summary.diagnosticCreditCents,
      }),
    };
  }, [type, value, tax, summary.subtotalCents, summary.taxCents, summary.diagnosticCreditCents]);

  if (!canEdit || lockedBecause) {
    return (
      <p className="text-xs text-ink-muted">
        {lockedBecause || "Your business owner has turned off billing changes for technicians, so only an owner or admin can give a discount."}
      </p>
    );
  }

  const balanceAfter = preview.totals ? Math.max(0, preview.totals.totalCents - summary.paidCents) : 0;

  return (
    <form action={save} className="space-y-3">
      <input type="hidden" name="invoiceId" value={summary.invoiceId} />
      <input type="hidden" name="discountType" value={type} />
      <div>
        <span className="text-xs font-semibold text-ink-muted">Discount</span>
        <div className="mt-1 grid grid-cols-3 gap-2" role="radiogroup" aria-label="Discount type">
          {(
            [
              ["none", "None"],
              ["percentage", "Percent"],
              ["fixed", "Amount"],
            ] as const
          ).map(([choice, label]) => (
            <button
              key={choice}
              type="button"
              role="radio"
              aria-checked={type === choice}
              onClick={() => setType(choice)}
              className={`tap-target min-h-11 rounded-control border px-2 text-sm font-semibold ${type === choice ? "border-brand bg-brand/10" : "border-line"}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {type !== "none" ? (
        <>
          <label className="block">
            <span className="text-xs font-semibold text-ink-muted">{type === "percentage" ? "Percent off (0–100)" : "Amount off"}</span>
            <div className="relative mt-1">
              <input
                name="discountValue"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                inputMode="decimal"
                placeholder={type === "percentage" ? "10" : "150.00"}
                className={`${inputClass} ${type === "percentage" ? "pr-10" : ""}`}
              />
              {type === "percentage" ? (
                <Percent className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden />
              ) : null}
            </div>
          </label>
          <label className="block">
            <span className="text-xs font-semibold text-ink-muted">Reason (optional)</span>
            <input
              name="discountReason"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              maxLength={300}
              placeholder="Customer loyalty discount"
              className={`mt-1 ${inputClass}`}
            />
          </label>
        </>
      ) : (
        <input type="hidden" name="discountValue" value="" />
      )}

      <label className="block">
        <span className="text-xs font-semibold text-ink-muted">Tax</span>
        <input name="tax" value={tax} onChange={(event) => setTax(event.target.value)} inputMode="decimal" className={`mt-1 ${inputClass}`} />
        <span className="mt-1 block text-xs text-ink-faint">
          The tax amount on this invoice. If the discount changes what is taxable where you work, correct it here.
        </span>
      </label>

      {/* What saving will do, before it is saved. */}
      {preview.totals ? (
        <dl className="space-y-1 rounded-control border border-line bg-raised/40 p-3 text-sm" aria-live="polite">
          <Row label="Subtotal" value={formatCents(preview.totals.subtotalCents)} />
          {preview.totals.discountCents > 0 ? (
            <>
              <Row label={preview.label} value={`−${formatCents(preview.totals.discountCents)}`} muted />
              <Row label="Discounted subtotal" value={formatCents(preview.totals.subtotalCents - preview.totals.discountCents)} muted />
            </>
          ) : null}
          {preview.totals.diagnosticCreditCents > 0 ? (
            <Row label="Diagnostic fee already paid" value={`−${formatCents(preview.totals.diagnosticCreditCents)}`} muted />
          ) : null}
          {preview.totals.taxCents > 0 ? <Row label="Tax" value={formatCents(preview.totals.taxCents)} muted /> : null}
          <Row label="Invoice total" value={formatCents(preview.totals.totalCents)} strong />
          {summary.paidCents > 0 ? <Row label="Still owed after payments" value={formatCents(balanceAfter)} muted /> : null}
          {summary.paidCents > preview.totals.totalCents ? (
            <p className="pt-1 text-xs text-critical">That would bring the invoice below what has already been paid on it.</p>
          ) : null}
        </dl>
      ) : (
        <p className="text-sm text-critical">{preview.error}</p>
      )}

      <button
        type="submit"
        disabled={saving || !preview.totals || summary.paidCents > (preview.totals?.totalCents ?? 0)}
        className="tap-target inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand disabled:opacity-60"
      >
        {saving ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : null}
        {type === "none" ? (current === "none" ? "Save" : "Remove discount") : current === "none" ? "Apply discount" : "Update discount"}
      </button>
      {summary.lastSentAt ? (
        <p className="text-xs text-ink-faint">The customer already has this invoice. After saving, send it again so they have the new figures.</p>
      ) : null}
      <FormMessage error={state.error} notice={state.notice} />
    </form>
  );
}
