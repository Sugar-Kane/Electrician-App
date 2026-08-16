import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import SlugBookingPage from "@/app/book/[slug]/page";
import { getBookingPageByHost } from "@/lib/public-booking";

/**
 * The booking page on the electrician's own domain.
 *
 * The middleware has already decided this request is for a tenant host and put
 * the normalised name in a header; this resolves it to a slug and renders the
 * canonical page. Delegating rather than copying is deliberate — the safety
 * questions, the service-area check and the consent copy must be identical on
 * both addresses, and the version a paying customer actually sees is this one.
 */
export const metadata: Metadata = {
  title: "Book an electrical diagnostic",
  /*
   * Not indexed. The subdomain would otherwise compete with the electrician's
   * own site for their own name, and a booking form outranking their homepage
   * is a worse result than not appearing at all.
   */
  robots: { index: false, follow: false },
};

export async function slugForRequestHost(): Promise<string> {
  const host = (await headers()).get("x-booking-host") ?? "";
  const page = await getBookingPageByHost(host);
  return page?.slug ?? "";
}

export default async function BookingByHostRoute({
  searchParams,
}: {
  searchParams: Promise<{ checkout?: string }>;
}) {
  const slug = await slugForRequestHost();
  if (!slug) notFound();

  return SlugBookingPage({ params: Promise.resolve({ slug }), searchParams });
}
