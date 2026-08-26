import type { MetadataRoute } from "next";

import { listPublicJournal } from "@/lib/journal-data";
import { appSitemapCarries, journalIndexPath, journalPostPath, originOf } from "@/lib/journal-urls";
import { listJournalOrganizations } from "@/lib/journal-sitemap";

/**
 * The app's sitemap, which until now did not exist at all.
 *
 * Only the journal is in it, deliberately. Everything else here is either the
 * product behind a login or a booking page that is `noindex` on purpose, and a
 * sitemap listing URLs that tell crawlers not to index them is noise that makes
 * the useful entries harder to find.
 *
 * A business with a verified hostname of its own is **left out**, because its
 * posts are canonical there and this file is on the wrong domain to be claiming
 * them. `book/by-host/sitemap.ts` serves those, on the hostname that owns them.
 */

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const origin = originOf(process.env.NEXT_PUBLIC_APP_URL);
  if (!origin) return [];

  const organizations = await listJournalOrganizations();
  const entries: MetadataRoute.Sitemap = [];

  for (const organization of organizations) {
    // Canonical elsewhere. Listing it here asks a crawler to index a URL whose
    // own tag points at a different host, which is a contradiction it resolves
    // by trusting neither. The tenant sitemap applies the other half of this
    // same rule, so every post is submitted exactly once.
    if (!appSitemapCarries(organization.hostname)) continue;

    entries.push({
      url: `${origin}${journalIndexPath(organization.slug, false)}`,
      lastModified: organization.newest ? new Date(organization.newest) : undefined,
      changeFrequency: "weekly",
    });

    for (const post of await listPublicJournal(organization.slug, 200)) {
      entries.push({
        url: `${origin}${journalPostPath(organization.slug, post.slug, false)}`,
        lastModified: post.publishedAt ? new Date(post.publishedAt) : undefined,
        changeFrequency: "monthly",
      });
    }
  }

  return entries;
}
