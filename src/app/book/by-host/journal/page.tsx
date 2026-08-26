import type { Metadata } from "next";

import { notFound } from "next/navigation";

import { slugForRequestHost } from "@/app/book/by-host/page";
import { JournalIndex } from "@/components/journal-article";
import { listPublicJournal, verifiedHostFor } from "@/lib/journal-data";
import { canonicalIndexUrl, journalPostPath } from "@/lib/journal-urls";
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

/**
 * The canonical, which static metadata could not carry.
 *
 * The post pages compute one and this exported an object with a title and a
 * robots rule and nothing else, so the index existed at two addresses with
 * neither claiming to be the real one. `generateMetadata` can resolve the host
 * the request came in on, which is what the canonical depends on.
 */
export async function generateMetadata(): Promise<Metadata> {
  const slug = await slugForRequestHost();
  if (!slug) return { title: "Work journal", robots: { index: false, follow: false } };

  const [page, host] = await Promise.all([getPublicBookingPage(slug), verifiedHostFor(slug)]);
  const canonical = canonicalIndexUrl({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    tenantHost: host,
    orgSlug: slug,
  });

  return {
    title: page ? `Work journal | ${page.display_name}` : "Work journal",
    ...(page
      ? {
          description: `Electrical problems around ${page.base_city}, ${page.base_state}, and what is usually behind them.`,
        }
      : {}),
    ...(canonical ? { alternates: { canonical } } : {}),
    robots: { index: true, follow: true },
  };
}

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
