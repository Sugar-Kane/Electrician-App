import type { Metadata } from "next";
import { FileText, History, Phone } from "lucide-react";

import { createPublicClient } from "@/lib/supabase/public";

/**
 * The customer's estimate, by the link they were texted or emailed.
 *
 * Laid out like the invoice page so the two read as one business's paperwork:
 * the total for the work, what it is for, and who to call. Nothing to sign and
 * nothing to pay here. When the business sends an updated estimate, this link
 * says a newer one replaced it rather than showing an old figure as current.
 *
 * Reached by an unguessable token, not a session, through a read-only function
 * that returns only what this page shows — never the admin fee or line items.
 */

export const metadata: Metadata = {
  title: "Your estimate",
  robots: { index: false, follow: false },
};

type EstimateByLink = {
  business_name: string;
  business_phone: string | null;
  customer_name: string | null;
  estimate_number: number;
  job_number: number | null;
  status: string;
  subtotal_cents: number | null;
  diagnostic_credit_cents: number | null;
  tax_cents: number | null;
  total_cents: number | null;
  expires_at: string | null;
  last_sent_at: string | null;
  created_at: string;
  work_summary: string | null;
  time_zone: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);

export default async function EstimateByLinkPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let estimate: EstimateByLink | null = null;
  if (UUID.test(token)) {
    const { data } = await createPublicClient().rpc("get_estimate_by_link", { p_token: token });
    estimate = Array.isArray(data) && data.length > 0 ? (data[0] as EstimateByLink) : null;
  }

  if (!estimate) {
    return (
      <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <h1 className="text-2xl font-semibold">We could not find that estimate</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            The link may be old, or it may have been copied incompletely. Call the business and they will send it again.
          </p>
        </section>
      </main>
    );
  }

  const timeZone = estimate.time_zone || "America/Los_Angeles";
  const total = estimate.total_cents ?? 0;
  const date = (iso: string | null) =>
    iso ? new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", year: "numeric" }).format(new Date(iso)) : "";
  const replaced = estimate.status === "expired";
  const lapsed = !replaced && Boolean(estimate.expires_at) && Date.parse(estimate.expires_at ?? "") < Date.now();
  const tel = (estimate.business_phone ?? "").replace(/[^\d+]/g, "");

  return (
    <main id="main-content" className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 sm:p-8">
        <span className={`grid h-14 w-14 place-items-center rounded-full ${replaced || lapsed ? "bg-white/5 text-ink-muted" : "bg-info-bg text-info"}`}>
          {replaced || lapsed ? <History className="h-7 w-7" aria-hidden /> : <FileText className="h-7 w-7" aria-hidden />}
        </span>

        <p className="mt-5 text-xs font-semibold uppercase tracking-[0.14em] text-ink-muted">Estimate EST-{estimate.estimate_number}</p>
        <h1 className="mt-1 text-2xl font-semibold">Total {money(total)}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {estimate.business_name}
          {estimate.customer_name ? ` · for ${estimate.customer_name}` : ""}
        </p>

        {replaced ? (
          <p className="mt-5 rounded-control border border-caution/40 bg-caution-bg/40 p-3 text-sm leading-6">
            {estimate.business_name} has sent you a newer estimate, which replaces this one. Use the latest link they sent, or call
            them.
          </p>
        ) : lapsed ? (
          <p className="mt-5 rounded-control border border-caution/40 bg-caution-bg/40 p-3 text-sm leading-6">
            This estimate was valid until {date(estimate.expires_at)}. Call {estimate.business_name} for an up-to-date price.
          </p>
        ) : (
          <p className="mt-5 rounded-control border border-info/40 bg-info-bg/40 p-3 text-sm leading-6">
            This is the total you will pay for the work. There is nothing to sign and nothing is due now.
          </p>
        )}

        {estimate.work_summary ? <p className="mt-5 text-sm leading-6 text-ink-muted">{estimate.work_summary}</p> : null}

        {/* The customer sees the total for the work, as on the invoice: the
            electrician keeps the line items. */}
        <div className="mt-5 flex items-start justify-between gap-3 border-y border-line py-3 text-sm">
          <span className="min-w-0">
            <span className="block font-semibold">Electrical work</span>
            <span className="text-xs text-ink-faint">Labor and materials</span>
          </span>
          <span className="shrink-0 font-semibold">{money(estimate.subtotal_cents ?? total)}</span>
        </div>

        <dl className="mt-4 space-y-1.5 text-sm">
          {estimate.diagnostic_credit_cents ? (
            <div className="flex justify-between text-ink-muted">
              <dt>Diagnostic fee already paid</dt>
              <dd>−{money(estimate.diagnostic_credit_cents)}</dd>
            </div>
          ) : null}
          {estimate.tax_cents ? (
            <div className="flex justify-between text-ink-muted">
              <dt>Tax</dt>
              <dd>{money(estimate.tax_cents)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-base font-semibold">
            <dt>Total</dt>
            <dd>{money(total)}</dd>
          </div>
        </dl>

        <dl className="mt-5 space-y-1 text-xs text-ink-muted">
          <div className="flex justify-between gap-3">
            <dt>Sent</dt>
            <dd>{date(estimate.last_sent_at ?? estimate.created_at)}</dd>
          </div>
          {estimate.expires_at ? (
            <div className="flex justify-between gap-3">
              <dt>Valid until</dt>
              <dd>{date(estimate.expires_at)}</dd>
            </div>
          ) : null}
        </dl>

        {estimate.business_phone ? (
          <a
            href={`tel:${tel}`}
            className="tap-target mt-8 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 py-2 text-center font-semibold text-on-brand"
          >
            <Phone className="h-5 w-5" aria-hidden />
            <span>
              Questions, or ready to book? Call <span className="whitespace-nowrap">{estimate.business_phone}</span>
            </span>
          </a>
        ) : null}
      </section>
    </main>
  );
}
