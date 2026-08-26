import type { MetadataRoute } from "next";
import { headers } from "next/headers";

import { listPublicJournal } from "@/lib/journal-data";
import { journalIndexPath, journalPostPath } from "@/lib/journal-urls";
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
 */

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const host = (await headers()).get("x-booking-host") ?? "";
  if (!host) return [];

  const page = await getBookingPageByHost(host);
  if (!page) return [];

  const origin = `https://${host}`;
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
