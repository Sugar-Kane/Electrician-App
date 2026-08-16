import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import SlugConfirmationPage from "@/app/book/[slug]/confirmation/page";
import { getBookingPageByHost } from "@/lib/public-booking";

/**
 * Where Stripe returns a customer who paid on the electrician's own domain.
 *
 * This route existing is what stops the booking breaking at the worst possible
 * moment. The checkout return URL is built from the request's own origin, so a
 * customer who started on `book.acme.com` comes back to `book.acme.com/confirmation`
 * — which would be a 404 if only the slug route existed, after they had been
 * charged.
 */
export const metadata: Metadata = {
  title: "Diagnostic confirmed",
  robots: { index: false, follow: false },
};

export default async function ConfirmationByHostRoute({
  searchParams,
}: {
  searchParams: Promise<{ session_id?: string }>;
}) {
  const host = (await headers()).get("x-booking-host") ?? "";
  const page = await getBookingPageByHost(host);
  if (!page) notFound();

  return SlugConfirmationPage({
    params: Promise.resolve({ slug: page.slug }),
    searchParams,
  });
}
