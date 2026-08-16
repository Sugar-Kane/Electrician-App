import {
  CalendarCheck2,
  CheckCircle2,
  MapPinned,
  Phone,
  ShieldCheck,
  Zap,
} from "lucide-react";

import { PublicBookingFlow } from "@/components/public-booking-flow";
import { brandTheme } from "@/lib/branding";
import { logoUrl } from "@/lib/branding-storage";
import type { PublicBookingPage, PublicBookingSlot } from "@/lib/public-booking";

/**
 * The booking page, wherever it is reached from.
 *
 * One component for `/book/<slug>` and for a tenant's own `book.` subdomain,
 * because the two must not drift: the subdomain is the version a paying
 * customer is most likely to see, and a second copy is how it ends up a version
 * behind on the safety questions.
 *
 * Branding is two CSS variables and a logo. Everything below already reads
 * `bg-brand` and `text-on-brand`, so overriding the tokens on the wrapper themes
 * the entire flow — including the parts inside `PublicBookingFlow` — without a
 * single component knowing whose page it is.
 */

export function BookingPage({
  bookingPage,
  messagingBusinessName,
  slots,
  checkoutCanceled,
}: {
  bookingPage: PublicBookingPage;
  messagingBusinessName: string;
  slots: PublicBookingSlot[];
  checkoutCanceled: boolean;
}) {
  const theme = brandTheme(bookingPage.brand_color);
  const logo = logoUrl(bookingPage.logo_path);

  return (
    <main
      className="min-h-screen bg-canvas px-3 py-4 text-white sm:px-5 sm:py-6 lg:px-8 lg:py-8"
      /*
        `--color-on-brand` is computed from the accent rather than chosen. This
        app has already shipped white-on-yellow at about 1.5:1 once; letting a
        tenant pick the colour without deriving the text from it would put that
        same unreadable button on their own booking page.
      */
      style={
        {
          "--color-brand": theme.brand,
          "--color-on-brand": theme.onBrand,
        } as React.CSSProperties
      }
    >
      <div className="mx-auto max-w-6xl">
        <header className="flex min-h-14 items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-2 text-lg font-bold tracking-[0.04em]">
              {logo ? (
                /*
                  A plain img, not next/image. The file is on a tenant's own
                  storage path and its dimensions are unknown, and running it
                  through the optimizer would cost a round trip on the one page
                  where first paint decides whether somebody books.
                */
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={logo}
                  alt={bookingPage.display_name}
                  className="h-8 max-w-[180px] object-contain"
                />
              ) : (
                <>
                  <Zap className="h-7 w-7 fill-brand text-brand" aria-hidden />
                  <span className="truncate">{bookingPage.display_name}</span>
                </>
              )}
            </div>
            <p className="mt-1 text-xs text-ink-faint">Electrical service booking</p>
          </div>
          {bookingPage.business_phone ? (
            <a
              href={`tel:${bookingPage.business_phone}`}
              className="tap-target flex min-h-12 items-center gap-2 rounded-control border border-line bg-white/[0.03] px-4 text-sm font-semibold text-white"
            >
              <Phone className="h-4 w-4 text-brand" aria-hidden />
              <span className="hidden sm:inline">Call</span>
            </a>
          ) : null}
        </header>

        <div className="mt-7 grid gap-6 lg:grid-cols-[minmax(0,.72fr)_minmax(520px,1.28fr)] lg:items-start">
          <section className="lg:sticky lg:top-8">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-brand">
              Paid diagnostic booking
            </p>
            <h1 className="mt-4 max-w-lg text-3xl font-semibold leading-tight tracking-tight sm:text-4xl lg:text-5xl">
              Get the right electrician onsite without guessing at the repair.
            </h1>
            <p className="mt-5 max-w-xl text-base leading-7 text-ink-muted">
              Describe the issue, complete a brief safety check, and choose an arrival window. The
              diagnostic fee is credited toward approved repair work.
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
                <div key={item.title} className="rounded-control border border-line bg-white/[0.03] p-4">
                  <p className="flex items-center gap-2 text-sm font-semibold text-white">
                    <item.icon className="h-4 w-4 text-brand" aria-hidden /> {item.title}
                  </p>
                  <p className="mt-2 text-xs leading-5 text-ink-faint">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="mt-7 rounded-control border border-positive/15 bg-positive-bg p-4 text-sm leading-6 text-ink-muted">
              <p className="flex items-center gap-2 font-semibold text-ink">
                <CheckCircle2 className="h-4 w-4 text-positive" aria-hidden /> No repair is charged
                today
              </p>
              <p className="mt-2">
                Only the diagnostic visit is paid during booking. Any repair scope is reviewed with
                you onsite and is due after completed work.
              </p>
            </div>
          </section>

          <PublicBookingFlow
            bookingPage={bookingPage}
            messagingBusinessName={messagingBusinessName}
            slots={slots}
            checkoutCanceled={checkoutCanceled}
          />
        </div>

        <footer className="mt-8 border-t border-line py-6 text-center text-xs text-ink-faint">
          Booking powered by Volteira · Your information is used to schedule service, verify the
          service area, and process payment securely with Stripe.
        </footer>
      </div>
    </main>
  );
}
