import type { Metadata } from "next";
import { CheckCircle2, Eye, Phone, ReceiptText } from "lucide-react";

import { createPublicClient } from "@/lib/supabase/public";

/**
 * The customer's invoice, by the link they were texted or emailed.
 *
 * One link, two moments. While the invoice is a draft it is a preview, sent
 * once the contract is signed: what they will be billed, with nothing due yet
 * and the final invoice to follow when the work is complete. Once sent it is
 * the bill itself, and once paid it says so.
 *
 * Reached by an unguessable token, not a session. It shows the customer their
 * own invoice and nothing that would help anyone find another.
 */

export const metadata: Metadata = {
  title: "Your invoice",
  robots: { index: false, follow: false },
};

type Line = { kind: string; description: string; quantity: number; unit: string; unit_price_cents: number };

type InvoiceByLink = {
  business_name: string;
  business_phone: string | null;
  customer_name: string | null;
  invoice_number: number;
  status: string;
  subtotal_cents: number | null;
  diagnostic_credit_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  balance_due_cents: number | null;
  due_at: string | null;
  last_sent_at: string | null;
  paid_at: string | null;
  work_summary: string | null;
  time_zone: string | null;
  lines: Line[] | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

function quantityLabel(line: Line): string {
  const quantity = Number(line.quantity) || 0;
  const whole = Number.isInteger(quantity) ? String(quantity) : quantity.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
  const unit = line.unit && line.unit !== "each" ? ` ${line.unit}` : "";
  return `${whole}${unit}`;
}

export default async function InvoiceByLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let invoice: InvoiceByLink | null = null;
  if (UUID.test(token)) {
    const { data } = await createPublicClient().rpc("get_invoice_by_link", { p_token: token });
    invoice = Array.isArray(data) && data.length > 0 ? (data[0] as InvoiceByLink) : null;
  }

  if (!invoice) {
    return (
      <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <h1 className="text-2xl font-semibold">We could not find that invoice</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            The link may be old, or it may have been copied incompletely. Call the business and they will send it again.
          </p>
        </section>
      </main>
    );
  }

  const timeZone = invoice.time_zone || "America/Los_Angeles";
  const paid = invoice.status === "paid" || Boolean(invoice.paid_at);
  const preview = !paid && invoice.status === "draft" && !invoice.last_sent_at;
  const lines = Array.isArray(invoice.lines) ? invoice.lines : [];
  const total = invoice.total_cents ?? 0;
  const owed = invoice.balance_due_cents ?? total;
  const dueLabel = invoice.due_at
    ? new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(invoice.due_at))
    : "";
  const tel = (invoice.business_phone ?? "").replace(/[^\d+]/g, "");

  return (
    <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 sm:p-8">
        <span
          className={`grid h-14 w-14 place-items-center rounded-full ${
            paid ? "bg-positive-bg text-positive" : preview ? "bg-info-bg text-info" : "bg-caution-bg text-caution"
          }`}
        >
          {paid ? <CheckCircle2 className="h-7 w-7" aria-hidden /> : preview ? <Eye className="h-7 w-7" aria-hidden /> : <ReceiptText className="h-7 w-7" aria-hidden />}
        </span>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">
          {preview ? "Invoice preview" : `Invoice INV-${invoice.invoice_number}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">
          {paid ? "Paid, thank you" : preview ? `Estimated total ${money(total)}` : `${money(owed)} due${dueLabel ? ` ${dueLabel}` : ""}`}
        </h1>
        <p className="mt-2 text-sm text-ink-muted">
          {invoice.business_name}
          {invoice.customer_name ? ` · for ${invoice.customer_name}` : ""}
        </p>

        {preview ? (
          <p className="mt-5 rounded-control border border-info/40 bg-info-bg/40 p-3 text-sm leading-6">
            This is a preview, not a bill. Nothing is due yet: the final invoice will be sent when the work is complete.
          </p>
        ) : null}

        {invoice.work_summary ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">{invoice.work_summary}</p>
        ) : null}

        {lines.length > 0 ? (
          <ul className="mt-5 divide-y divide-line border-y border-line text-sm">
            {lines.map((line, index) => (
              <li key={index} className="flex items-start justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block">{line.description}</span>
                  <span className="text-xs text-ink-faint">
                    {quantityLabel(line)} × {money(Number(line.unit_price_cents) || 0)}
                  </span>
                </span>
                <span className="shrink-0 font-semibold">
                  {money(Math.round((Number(line.quantity) || 0) * (Number(line.unit_price_cents) || 0)))}
                </span>
              </li>
            ))}
          </ul>
        ) : null}

        <dl className="mt-4 space-y-1.5 text-sm">
          {invoice.subtotal_cents !== null && invoice.subtotal_cents !== total ? (
            <div className="flex justify-between text-ink-muted">
              <dt>Subtotal</dt>
              <dd>{money(invoice.subtotal_cents)}</dd>
            </div>
          ) : null}
          {invoice.diagnostic_credit_cents ? (
            <div className="flex justify-between text-ink-muted">
              <dt>Diagnostic fee already paid</dt>
              <dd>−{money(invoice.diagnostic_credit_cents)}</dd>
            </div>
          ) : null}
          {invoice.tax_cents ? (
            <div className="flex justify-between text-ink-muted">
              <dt>Tax</dt>
              <dd>{money(invoice.tax_cents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <dt>{preview ? "Estimated total" : "Total"}</dt>
            <dd>{money(total)}</dd>
          </div>
          {!preview && !paid && owed !== total ? (
            <div className="flex justify-between font-semibold text-caution">
              <dt>Still owed</dt>
              <dd>{money(owed)}</dd>
            </div>
          ) : null}
        </dl>

        {invoice.business_phone ? (
          <a
            href={`tel:${tel}`}
            className="tap-target mt-8 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 py-2 text-center font-semibold text-on-brand"
          >
            <Phone className="h-5 w-5" aria-hidden />
            <span>
              {paid ? "Call " : preview ? "Questions? Call " : "Call "}
              {/* The number never breaks across lines. */}
              <span className="whitespace-nowrap">{invoice.business_phone}</span>
              {!paid && !preview ? " to pay" : ""}
            </span>
          </a>
        ) : null}
      </section>
    </main>
  );
}
