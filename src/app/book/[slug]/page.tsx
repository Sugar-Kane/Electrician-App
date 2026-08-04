import type { Metadata } from "next";
import { notFound } from "next/navigation";
import {
  CalendarCheck2,
  CheckCircle2,
  MapPinned,
  Phone,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { PublicBookingFlow } from "@/components/public-booking-flow";
import { getPublicBookingPage, getPublicBookingSlots } from "@/lib/public-booking";

export const metadata: Metadata = {
  title: "Book an electrical diagnostic | Volterra",
  description: "Request and securely pay for an onsite electrical diagnostic.",
};

export default async function PublicBookingPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [bookingPage, slots] = await Promise.all([
    getPublicBookingPage(slug),
    getPublicBookingSlots(slug),
  ]);

  if (!bookingPage) notFound();

  return (
    <main className="min-h-screen bg-[#06131d] px-3 py-4 text-white sm:px-5 sm:py-6 lg:px-8 lg:py-8">
      <div className="mx-auto max-w-6xl">
        <header className="flex min-h-14 items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 text-lg font-bold tracking-[0.04em]">
              <Zap className="h-7 w-7 fill-[#ffc21c] text-[#ffc21c]" aria-hidden />
              {bookingPage.display_name}
            </div>
            <p className="mt-1 text-xs text-slate-500">Electrical service booking</p>
          </div>
          {bookingPage.business_phone ? (
            <a
              href={`tel:${bookingPage.business_phone}`}
              className="tap-target flex min-h-12 items-center gap-2 rounded-2xl border border-white/10 bg-white/[0.03] px-4 text-sm font-semibold text-white"
            >
              <Phone className="h-4 w-4 text-[#ffc21c]" aria-hidden />
              <span className="hidden sm:inline">Call</span>
            </a>
          ) : null}
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,.72fr)_minmax(520px,1.28fr)] lg:items-start">
          <section className="lg:sticky lg:top-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#ffc21c]">
              Paid diagnostic booking
            </p>
            <h1 className="mt-4 max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Get the right electrician onsite without guessing at the repair.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-slate-400">
              Describe the issue, complete a brief safety check, and choose an arrival window. The diagnostic fee is credited toward approved repair work.
            </p>

            <div className="mt-7 grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
              {[
                {
                  icon: ShieldCheck,
                  title: "Safety first",
                  body: "Questions adapt to what you report and pause booking for immediate hazards.",
                },
                {
                  icon: CalendarCheck2,
                  title: "Real availability",
                  body: "Openings already account for working hours, scheduled jobs, and blackout time.",
                },
                {
                  icon: MapPinned,
                  title: "Service-area checked",
                  body: `Automatic booking is available within ${bookingPage.automatic_booking_radius_miles} miles of ${bookingPage.base_city}.`,
                },
              ].map((item) => (
                <div key={item.title} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    <item.icon className="h-4 w-4 text-[#ffc21c]" aria-hidden /> {item.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-slate-500">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-7 rounded-2xl border border-emerald-400/15 bg-emerald-400/[0.04] p-4 text-sm leading-6 text-slate-400">
              <p className="flex items-center gap-2 font-semibold text-slate-200">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" aria-hidden /> No repair is charged today
              </p>
              <p className="mt-2">Only the diagnostic visit is paid during booking. Any repair scope is reviewed with you onsite and is due after completed work.</p>
            </div>
          </section>

          <PublicBookingFlow
            bookingPage={bookingPage}
            slots={slots}
            checkoutCanceled={query.checkout === "canceled"}
          />
        </div>

        <footer className="mt-8 border-t border-white/10 py-6 text-center text-xs text-slate-600">
          Booking powered by Volterra · Your information is used to schedule service, verify the service area, and process payment securely with Stripe.
        </footer>
      </div>
    </main>
  );
}
