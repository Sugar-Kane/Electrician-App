import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JournalIndex } from "@/components/journal-article";
import { listPublicJournal, verifiedHostFor } from "@/lib/journal-data";
import { canonicalIndexUrl, journalPostPath } from "@/lib/journal-urls";
import { getPublicBookingPage } from "@/lib/public-booking";

/**
 * A business's journal, at its address on the product's own domain.
 *
 * Indexed, unlike the booking page next to it. That page is `noindex` on
 * purpose, because a booking form outranking an electrician's own homepage for
 * their own name is a worse result than not appearing at all. A post answering
 * "why does my breaker keep tripping" competes with nothing they own and is the
 * entire point of writing it.
 */

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string }>;
}): Promise<Metadata> {
  const { org } = await params;
  const [page, host] = await Promise.all([getPublicBookingPage(org), verifiedHostFor(org)]);
  if (!page) return { title: "Work journal" };

  const canonical = canonicalIndexUrl({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    tenantHost: host,
    orgSlug: org,
  });

  return {
    title: `Work journal | ${page.display_name}`,
    description: `Electrical problems around ${page.base_city}, ${page.base_state}, and what is usually behind them.`,
    ...(canonical ? { alternates: { canonical } } : {}),
    robots: { index: true, follow: true },
  };
}

export default async function JournalIndexRoute({
  params,
}: {
  params: Promise<{ org: string }>;
}) {
  const { org } = await params;
  const [page, posts] = await Promise.all([getPublicBookingPage(org), listPublicJournal(org)]);
  if (!page) notFound();

  return (
    <JournalIndex
      businessName={page.display_name}
      city={page.base_city}
      state={page.base_state}
      posts={posts}
      hrefFor={(slug) => journalPostPath(org, slug, false)}
    />
  );
}
