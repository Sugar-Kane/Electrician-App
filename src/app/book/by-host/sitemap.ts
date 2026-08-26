import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { listPublicJournal, verifiedHostFor } from "@/lib/journal-data";
import { journalIndexPath, journalPostPath, tenantSitemapOrigin } from "@/lib/journal-urls";
import { getBookingPageByHost } from "@/lib/public-booking";

/**
 * The sitemap on an electrician's own domain.
 *
 * This file exists because of a detail in `proxy.ts` that is easy to miss:
 * every non-API path on a tenant hostname is rewritten under `/book/by-host`,
 * and the middleware matcher excludes image extensions but not `.xml` or
 * `.txt`. So `blog.acme.com/sitemap.xml` lands here, and without this route it
 * would have 404ed on the one address whose posts are canonical.
 *
 * Only the journal. The booking page this hostname mainly serves is `noindex`
 * by design, so listing it would be asking a crawler to index a page that tells
 * it not to.
 *
 * And only once this hostname is **verified**. Resolving is not the same test:
 * `get_booking_page_by_host` matches a domain row whatever its `verified_at`,
 * so a domain still pending verification serves these pages already, while the
 * canonical on them keeps pointing home until it passes. Submitting from here
 * during that window would put every post in two sitemaps and advertise URLs
 * that disown themselves. Nothing is lost by waiting: the posts stay in the
 * product's sitemap the whole time, and move here the day it verifies.
 */

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("x-booking-host") ?? "";
  if (!host) return [];

  const page = await getBookingPageByHost(host);
  if (!page) return [];

  const origin = tenantSitemapOrigin({
    requestHost: host,
    verifiedHost: await verifiedHostFor(page.slug),
  });
  if (!origin) return [];

  const posts = await listPublicJournal(page.slug, 200);

  return [
    {
      url: `${origin}${journalIndexPath(page.slug, true)}`,
      lastModified: posts[0]?.publishedAt ? new Date(posts[0].publishedAt) : undefined,
      changeFrequency: "weekly",
    },
    ...posts.map((post) => ({
      url: `${origin}${journalPostPath(page.slug, post.slug, true)}`,
      lastModified: post.publishedAt ? new Date(post.publishedAt) : undefined,
      changeFrequency: "monthly" as const,
    })),
  ];
}
