import type { Metadata } from "next";
import { CalendarCheck2, Clock3, MapPin, Phone, ReceiptText } from "lucide-react";

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
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

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
      <main className="grid min-h-screen place-items-center bg-[#06131d] px-4 py-10 text-white">
        <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#081925] p-6 text-center sm:p-8">
          <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-amber-300/10 text-amber-200">
            <Clock3 className="h-7 w-7" aria-hidden />
          </span>
          <h1 className="mt-5 text-2xl font-semibold">We could not find that appointment</h1>
          <p className="mt-3 text-sm leading-6 text-slate-400">
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
  const fee = new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format((booking.diagnostic_fee_cents ?? 10000) / 100);

  return (
    <main className="grid min-h-screen place-items-center bg-[#06131d] px-4 py-10 text-white">
      <section className="w-full max-w-lg rounded-[28px] border border-white/10 bg-[#081925] p-6 sm:p-8">
        <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-400/10 text-emerald-300">
          <CalendarCheck2 className="h-7 w-7" aria-hidden />
        </span>

        <h1 className="mt-5 text-2xl font-semibold">
          {booking.contact_name ? `You're booked, ${booking.contact_name}` : "You're booked"}
        </h1>
        <p className="mt-2 text-sm text-slate-400">with {booking.business_name}</p>

        <dl className="mt-7 space-y-5 text-sm">
          {labels ? (
            <div className="flex gap-3">
              <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
              <div>
                <dt className="text-slate-400">Arrival window</dt>
                <dd className="mt-0.5 font-semibold">{labels.day}</dd>
                <dd className="text-slate-300">{labels.window}</dd>
              </div>
            </div>
          ) : null}

          {address ? (
            <div className="flex gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
              <div>
                <dt className="text-slate-400">Service address</dt>
                <dd className="mt-0.5 font-semibold">{address}</dd>
              </div>
            </div>
          ) : null}

          <div className="flex gap-3">
            <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-[#ffc21c]" aria-hidden />
            <div>
              <dt className="text-slate-400">Diagnostic visit</dt>
              <dd className="mt-0.5 font-semibold">{fee}</dd>
            </div>
          </div>

          {booking.description ? (
            <div className="flex gap-3">
              <ReceiptText className="mt-0.5 h-5 w-5 shrink-0 text-transparent" aria-hidden />
              <div>
                <dt className="text-slate-400">What you told us</dt>
                <dd className="mt-0.5 text-slate-200">{booking.description}</dd>
              </div>
            </div>
          ) : null}
        </dl>

        <a
          href={`tel:${booking.business_phone.replace(/[^\d+]/g, "")}`}
          className="tap-target mt-8 flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-[#ffc21c] px-5 font-semibold text-[#071723]"
        >
          <Phone className="h-5 w-5" aria-hidden />
          Call {booking.business_phone}
        </a>
        <p className="mt-3 text-center text-xs leading-5 text-slate-500">
          Need to change or cancel? Call and we will sort it out.
        </p>
      </section>
    </main>
  );
}
