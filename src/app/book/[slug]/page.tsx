import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { BookingPage } from "@/components/booking-page";
import { getPublicBookingPage, getPublicBookingSlots, getPublicDiagnosticPolicy } from "@/lib/public-booking";
import { getMessagingBusinessName } from "@/lib/supabase/public";

export const metadata: Metadata = {
  title: "Book an electrical diagnostic | Volteira",
  description: "Book an onsite electrical diagnostic. Nothing is charged today in California; the diagnostic fee is due when the service is completed.",
};

/**
 * The booking page at its canonical address.
 *
 * A tenant who has pointed their own subdomain at us is served the same page by
 * `book/by-host`; the markup lives in one component so the two cannot diverge.
 */
export default async function PublicBookingPageRoute({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ checkout?: string }>;
}) {
  const [{ slug }, query] = await Promise.all([params, searchParams]);
  const [bookingPage, slots, diagnosticPolicy] = await Promise.all([
    getPublicBookingPage(slug),
    getPublicBookingSlots(slug),
    getPublicDiagnosticPolicy(slug),
  ]);

  if (!bookingPage) notFound();

  const messagingBusinessName = await getMessagingBusinessName(
    slug,
    bookingPage.display_name,
  );

  return (
    <BookingPage
      bookingPage={bookingPage}
      messagingBusinessName={messagingBusinessName}
      slots={slots}
      diagnosticPolicy={diagnosticPolicy}
      checkoutCanceled={query.checkout === "canceled"}
    />
  );
}
