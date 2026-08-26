import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { slugForRequestHost } from "@/app/book/by-host/page";
import { JournalArticle } from "@/components/journal-article";
import { JournalStructuredData } from "@/components/journal-structured-data";
import { getPublicJournalPost, verifiedHostFor } from "@/lib/journal-data";
import { canonicalIndexUrl, canonicalPostUrl, journalIndexPath } from "@/lib/journal-urls";

/**
 * One post on the electrician's own domain, which is the address that should
 * rank.
 *
 * The canonical is computed rather than assumed to be this URL: a hostname can
 * reach here after its `verified_at` was cleared, and pointing the canonical at
 * an address that no longer verifies would take the post out of the index. So
 * it is built from the same lookup the product's own copy uses, and both pages
 * agree on which address is real.
 */

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const [{ slug }, org] = await Promise.all([params, slugForRequestHost()]);
  if (!org) return { title: "Not found", robots: { index: false, follow: false } };

  const [post, host] = await Promise.all([
    getPublicJournalPost(org, slug),
    verifiedHostFor(org),
  ]);
  if (!post) return { title: "Not found", robots: { index: false, follow: false } };

  const canonical = canonicalPostUrl({
    appUrl: process.env.NEXT_PUBLIC_APP_URL,
    tenantHost: host,
    orgSlug: org,
    postSlug: slug,
  });

  return {
    title: `${post.title} | ${post.businessName}`,
    description: post.dek || undefined,
    ...(canonical ? { alternates: { canonical } } : {}),
    robots: { index: true, follow: true },
    openGraph: {
      type: "article",
      title: post.title,
      description: post.dek || undefined,
      siteName: post.businessName,
      ...(canonical ? { url: canonical } : {}),
      publishedTime: post.publishedAt || undefined,
      modifiedTime: post.updatedAt || undefined,
    },
  };
}

export default async function TenantJournalPost({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const [{ slug }, org] = await Promise.all([params, slugForRequestHost()]);
  if (!org) notFound();

  const [post, host] = await Promise.all([
    getPublicJournalPost(org, slug),
    verifiedHostFor(org),
  ]);
  if (!post) notFound();

  /*
   * The structured data belongs here most of all.
   *
   * It was on the copy served from the product's own domain and missing from
   * this one, which is backwards: this is the address the canonical points at
   * once a business verifies a hostname, so it is the page a search engine is
   * being told to index.
   */
  return (
    <>
      <JournalStructuredData
        post={post}
        url={canonicalPostUrl({
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          tenantHost: host,
          orgSlug: org,
          postSlug: slug,
        })}
        indexUrl={canonicalIndexUrl({
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          tenantHost: host,
          orgSlug: org,
        })}
      />
      {/* Relative, so every link stays on the hostname the reader came in on. */}
      <JournalArticle post={post} indexHref={journalIndexPath(org, true)} bookHref="/" />
    </>
  );
}
