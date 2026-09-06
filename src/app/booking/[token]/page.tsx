import type { Metadata } from "next";
import {
  CalendarCheck2,
  Clock3,
  CreditCard,
  MapPin,
  Phone,
  ReceiptText,
} from "lucide-react";

import { bookingPageState, bookingPayNotice } from "@/lib/booking-page-state";
import { DEFAULT_DIAGNOSTIC_FEE_CENTS } from "@/lib/diagnostic-visit";
import { createPublicClient } from "@/lib/supabase/public";

/**
 * The page a customer reaches from the link in their confirmation.
 *
 * Reached by a token, not a session: the person who booked by phone has no
 * account and should not need one to check what they agreed to. The token is
 * the only thing standing between this and the world, so the page shows what
 * the caller already knows — their own appointment — and nothing that would
 * help someone guess at another.
 */

export const metadata: Metadata = {
  title: "Your appointment",
  // A confirmation link should not turn up in a search result.
  robots: { index: false, follow: false },
};

type Confirmation = {
  business_name: string;
  business_phone: string;
  contact_name: string | null;
  description: string | null;
  address_line_1: string | null;
  city: string | null;
  postal_code: string | null;
  arrival_window_start: string | null;
  arrival_window_end: string | null;
  diagnostic_fee_cents: number | null;
  time_zone: string | null;
  status: string | null;
  intake_answers: { question: string; answer: string }[] | null;
  deposit_cents: number | null;
  deposit_paid: boolean | null;
  expires_at: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function windowLabel(start: string, end: string, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date(start));
  const time = (value: string) =>
    new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(
      new Date(value),
    );
  return { day, window: `${time(start)} – ${time(end)}` };
}

export default async function BookingConfirmationPage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ pay?: string }>;
}) {
  const [{ token }, query] = await Promise.all([params, searchParams]);

  let booking: Confirmation | null = null;
  // Checked before the round trip: a malformed token is a typo or a probe, and
  // neither is worth a database call.
  if (UUID.test(token)) {
    const supabase = createPublicClient();
    const { data } = await supabase.rpc("get_phone_booking_confirmation", { p_token: token });
    booking = Array.isArray(data) && data.length > 0 ? (data[0] as Confirmation) : null;
  }

  if (!booking) {
    return (
      <main
        id="main-content"
        className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white"
      >
        <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 text-center sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-caution-bg text-caution">
            <Clock3 className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">We could not find that appointment</h1>
          <p className="mt-3 text-sm leading-6 text-ink-muted">
            The link may be old, or it may have been copied incompletely. Call the business and
            they will find your booking.
          </p>
        </section>
      </main>
    );
  }

  const timeZone = booking.time_zone || "America/Los_Angeles";
  const labels =
    booking.arrival_window_start && booking.arrival_window_end
      ? windowLabel(booking.arrival_window_start, booking.arrival_window_end, timeZone)
      : null;
  const address = [booking.address_line_1, booking.city, booking.postal_code]
    .filter(Boolean)
    .join(", ");
  const money = (cents: number) =>
    new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const fee = money(booking.diagnostic_fee_cents ?? DEFAULT_DIAGNOSTIC_FEE_CENTS);
  const depositCents =
    booking.deposit_cents ?? booking.diagnostic_fee_cents ?? DEFAULT_DIAGNOSTIC_FEE_CENTS;
  const deposit = money(depositCents);
  const answers = Array.isArray(booking.intake_answers) ? booking.intake_answers : [];
  const state = bookingPageState({
    status: booking.status,
    depositPaid: booking.deposit_paid === true,
    depositCents,
    expiresAt: booking.expires_at,
  });
  const awaitingPayment = state === "awaiting_payment";
  const confirmed = state === "confirmed";
  const paymentReview = state === "payment_review";
  // A stale query string must not make a paid appointment look canceled after
  // Stripe has already finished it.
  const notice = confirmed || paymentReview ? "" : bookingPayNotice(query.pay);

  const heading = confirmed
    ? booking.contact_name
      ? `You're booked, ${booking.contact_name}`
      : "You're booked"
    : awaitingPayment
      ? booking.contact_name
        ? `Your time is being held, ${booking.contact_name}`
        : "Your time is being held"
      : paymentReview
        ? "Payment received"
        : "Please call to confirm this appointment";

  return (
    <main
      id="main-content"
      className="grid min-h-screen place-items-center bg-canvas px-4 py-10 text-white"
    >
      <section className="w-full max-w-lg rounded-[28px] border border-line bg-[#081925] p-6 sm:p-8">
        <span
          className={`grid h-14 w-14 place-items-center rounded-full ${
            confirmed ? "bg-positive-bg text-positive" : "bg-caution-bg text-caution"
          }`}
        >
          {confirmed ? (
            <CalendarCheck2 className="h-7 w-7" aria-hidden />
          ) : (
            <Clock3 className="h-7 w-7" aria-hidden />
          )}
        </span>

        <h1 className="mt-5 text-2xl font-semibold">{heading}</h1>
        <p className="mt-2 text-sm text-ink-muted">with {booking.business_name}</p>

        {notice ? (
          <p className="mt-5 rounded-control border border-caution/40 bg-caution-bg/40 p-3 text-sm leading-6 text-caution">
            {notice}
          </p>
        ) : null}

        {awaitingPayment ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">
            This appointment is not confirmed until the diagnostic fee is paid.
          </p>
        ) : paymentReview ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">
            Do not pay again. The business has your payment and will contact you while the
            appointment is finalized.
          </p>
        ) : !confirmed ? (
          <p className="mt-5 text-sm leading-6 text-ink-muted">
            This time is not currently confirmed. Call the business before planning around it.
          </p>
        ) : null}

        <dl className="mt-7 space-y-5 text-sm">
          {labels ? (
            <div className="flex gap-3">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-ink-muted">Arrival window</dt>
                <dd className="mt-0.5 font-semibold">{labels.day}</dd>
                <dd className="text-ink-muted">{labels.window}</dd>
              </div>
            </div>
          ) : null}

          {address ? (
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
              <div>
                <dt className="text-ink-muted">Service address</dt>
                <dd className="mt-0.5 font-semibold">{address}</dd>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
            <div>
              <dt className="text-ink-muted">Diagnostic visit</dt>
              <dd className="mt-0.5 font-semibold">{fee}</dd>
            </div>
          </div>

          {booking.description ? (
            <div className="flex gap-3">
              <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-transparent" aria-hidden />
              <div>
                <dt className="text-ink-muted">What you told us</dt>
                <dd className="mt-0.5 text-ink">{booking.description}</dd>
              </div>
            </div>
          ) : null}
        </dl>

        {answers.length > 0 ? (
          <section className="mt-7 rounded-control border border-line bg-white/[0.03] p-4">
            <h2 className="text-sm font-semibold text-ink">What we went over on the call</h2>
            <dl className="mt-3 space-y-3 text-sm">
              {answers.map((entry, index) => (
                <div key={index}>
                  <dt className="text-ink-muted">{entry.question}</dt>
                  <dd className="mt-0.5 text-ink">{entry.answer}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs leading-5 text-ink-faint">
              An electrician will call to go over a few more details before the visit.
            </p>
          </section>
        ) : null}

        <section className="mt-5 rounded-control border border-line bg-white/[0.03] p-4">
          <h2 className="text-sm font-semibold text-ink">
            {confirmed
              ? "Diagnostic fee received"
              : awaitingPayment
                ? "Payment required to confirm"
                : paymentReview
                  ? "Payment received"
                  : "Diagnostic fee"}
          </h2>
          <p className="mt-1 text-2xl font-semibold">{deposit}</p>
          <p className="mt-2 text-xs leading-5 text-ink-muted">
            {confirmed || paymentReview
              ? "If more work is needed, this amount is credited toward the approved work order."
              : awaitingPayment
                ? "Pay securely to confirm. If more work is needed, this amount is credited toward the approved work order."
                : "Call the business to confirm whether payment is needed."}
          </p>
        </section>

        {awaitingPayment ? (
          <a
            href={`/booking/${encodeURIComponent(token)}/pay`}
            className="tap-target mt-6 flex min-h-12 items-center justify-center gap-2 rounded-control bg-brand px-5 font-semibold text-on-brand"
          >
            <CreditCard className="h-5 w-5" aria-hidden />
            Pay {deposit} securely
          </a>
        ) : null}

        {booking.business_phone ? (
          <a
            href={`tel:${booking.business_phone.replace(/[^\d+]/g, "")}`}
            className={`tap-target flex min-h-12 items-center justify-center gap-2 rounded-control px-5 font-semibold ${
              awaitingPayment
                ? "mt-3 border border-line text-white"
                : "mt-8 bg-brand text-on-brand"
            }`}
          >
            <Phone className="h-5 w-5" aria-hidden />
            Call {booking.business_phone}
          </a>
        ) : null}
        <p className="mt-3 text-center text-xs leading-5 text-ink-faint">
          Need to change or cancel? Call and we will sort it out.
        </p>
      </section>
    </main>
  );
}
