import type { Metadata } from "next";

import { notFound } from "next/navigation";

import { slugForRequestHost } from "@/app/book/by-host/page";
import { JournalIndex } from "@/components/journal-article";
import { listPublicJournal } from "@/lib/journal-data";
import { journalPostPath } from "@/lib/journal-urls";
import { getPublicBookingPage } from "@/lib/public-booking";

/**
 * The journal on the electrician's own domain.
 *
 * `proxy.ts` rewrites every non-API path on a tenant hostname, so a reader
 * typing `blog.acmeelectric.com/journal` arrives here. The host is resolved to
 * a slug the same way the booking page does it, and the markup comes from the
 * same component, so the two addresses cannot drift.
 *
 * Indexed, where the booking page beside it is not. That page is `noindex`
 * because a booking form outranking somebody's homepage for their own name is
 * a worse result than not appearing; posts answering questions their customers
 * are actually typing compete with nothing they own.
 */

export const revalidate = 300;

export const metadata: Metadata = {
  title: "Work journal",
  robots: { index: true, follow: true },
};

export default async function TenantJournalIndex() {
  const slug = await slugForRequestHost();
  if (!slug) notFound();

  const [page, posts] = await Promise.all([getPublicBookingPage(slug), listPublicJournal(slug)]);
  if (!page) notFound();

  return (
    <JournalIndex
      businessName={page.display_name}
      city={page.base_city}
      state={page.base_state}
      posts={posts}
      hrefFor={(postSlug) => journalPostPath(slug, postSlug, true)}
    />
  );
}
