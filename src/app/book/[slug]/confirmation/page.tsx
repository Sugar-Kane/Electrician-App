import type { Metadata } from "next";
import Link from "next/link";
import {
  CalendarCheck2,
  CheckCircle2,
  Clock3,
  MapPin,
  Phone,
  ReceiptText,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { fulfillPaidBooking } from "@/lib/stripe-booking";
import { getStripe } from "@/lib/stripe";

export const metadata: Metadata = {
  title: "Diagnostic confirmed | Volteira",
};

function formatCurrency(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ session_id?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const stripe = getStripe();
  let confirmation = null;

  if (stripe && query.session_id?.startsWith("cs_")) {
    try {
      const session = await stripe.checkout.sessions.retrieve(query.session_id);
      if (session.metadata?.organization_slug === slug) {
        confirmation = await fulfillPaidBooking(session);
      }
    } catch {
      confirmation = null;
    }
  }

  if (!confirmation) {
    return (
      <main className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-caution-bg text-caution">
            <Clock3 className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">Payment is still being confirmed</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            If you completed checkout, refresh this page in a moment. No duplicate charge will be created.
          </p>
          <Link href={`/book/${encodeURIComponent(slug)}`} className="tap-target mt-6 inline-flex min-h-12 items-center justify-center rounded-control border border-line px-5 text-sm font-semibold">
            Return to booking
          </Link>
        </section>
      </main>
    );
  }

  const windowStart = new Intl.DateTimeFormat("en-US", {
    timeZone: confirmation.timezone,
    weekday: "long",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(confirmation.arrival_window_start));
  const windowEnd = new Intl.DateTimeFormat("en-US", {
    timeZone: confirmation.timezone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(confirmation.arrival_window_end));

  return (
    <main className="min-h-screen bg-canvas px-3 py-5 text-white sm:px-5 sm:py-8">
      <div className="mx-auto max-w-2xl">
        <header className="flex items-center gap-2 text-lg font-bold tracking-[0.04em]">
          <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
          {confirmation.display_name}
        </header>

        <section className="mt-8 overflow-hidden rounded-[30px] border border-line bg-[#081925]">
          <div className="border-b border-positive/15 bg-positive-bg p-6 text-center sm:p-8">
            <span className="mx-auto grid h-16 w-16 place-items-center rounded-full bg-positive-bg text-positive">
              <CheckCircle2 className="h-9 w-9" aria-hidden />
            </span>
            <p className="mt-5 text-xs font-semibold uppercase tracking-[0.18em] text-positive">Payment received</p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">You’re booked, {confirmation.customer_first_name}.</h1>
            <p className="mt-3 text-sm leading-6 text-ink-muted">Your diagnostic visit is confirmed. A receipt has been sent by Stripe.</p>
          </div>

          <div className="space-y-3 p-4 sm:p-6">
            <div className="flex items-start gap-3 rounded-control border border-line bg-raised p-4">
              <CalendarCheck2 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-ink-faint">Arrival window</p>
                <p className="mt-1 text-sm font-semibold text-white">{windowStart}–{windowEnd}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-control border border-line bg-raised p-4">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <p className="text-xs uppercase tracking-[0.12em] text-ink-faint">Service location</p>
                <p className="mt-1 text-sm font-semibold text-white">{confirmation.service_city}, {confirmation.service_state}</p>
              </div>
            </div>
            <div className="flex items-start gap-3 rounded-control border border-line bg-raised p-4">
              <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-xs uppercase tracking-[0.12em] text-ink-faint">Diagnostic payment</p>
                <div className="mt-1 flex items-center justify-between gap-3 text-sm font-semibold text-white">
                  <span>Job #{confirmation.job_number}</span>
                  <span>{formatCurrency(confirmation.amount_paid_cents)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-line p-5 sm:p-6">
            <p className="flex items-start gap-2 text-sm leading-6 text-ink-muted">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-positive" aria-hidden />
              The electrician will diagnose the issue onsite and review any repair scope with you before additional work is charged.
            </p>
            {confirmation.business_phone ? (
              <a href={`tel:${confirmation.business_phone}`} className="tap-target mt-5 flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-line text-sm font-semibold text-white">
                <Phone className="h-4 w-4 text-brand" aria-hidden /> Call {confirmation.business_phone}
              </a>
            ) : null}
          </div>
        </section>
      </div>
    </main>
  );
}
