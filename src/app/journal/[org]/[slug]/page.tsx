import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { JournalArticle } from "@/components/journal-article";
import { getPublicJournalPost, verifiedHostFor } from "@/lib/journal-data";
import { canonicalPostUrl, journalIndexPath } from "@/lib/journal-urls";

/**
 * One post, at its address on the product's own domain.
 *
 * The canonical is the interesting part. This URL and the one on a business's
 * own verified subdomain serve the same words, and only one of them may be the
 * canonical or the ranking splits between two addresses and neither wins. It
 * points at the tenant hostname the moment one is verified, so the accumulated
 * value follows the business onto their own name rather than staying here.
 */

export const revalidate = 300;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ org: string; slug: string }>;
}): Promise<Metadata> {
  const { org, slug } = await params;
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

export default async function JournalPostRoute({
  params,
}: {
  params: Promise<{ org: string; slug: string }>;
}) {
  const { org, slug } = await params;
  const [post, host] = await Promise.all([
    getPublicJournalPost(org, slug),
    verifiedHostFor(org),
  ]);

  if (!post) notFound();

  return (
    <>
      <StructuredData
        post={post}
        url={canonicalPostUrl({
          appUrl: process.env.NEXT_PUBLIC_APP_URL,
          tenantHost: host,
          orgSlug: org,
          postSlug: slug,
        })}
      />
      <JournalArticle
        post={post}
        indexHref={journalIndexPath(org, false)}
        bookHref={`/book/${org}`}
      />
    </>
  );
}

/**
 * What a search engine is told this page is.
 *
 * `areaServed` is the part that earns local results, and it is the reason to
 * bother: a post about tripping breakers is one of thousands, and a post about
 * tripping breakers by an electrician who works in this town is the one a
 * person in this town should be shown.
 *
 * Serialised with `JSON.stringify`, which escapes anything in the model's prose
 * that would otherwise close the script tag early.
 */
function StructuredData({
  post,
  url,
}: {
  post: Awaited<ReturnType<typeof getPublicJournalPost>>;
  url: string;
}) {
  if (!post) return null;

  const data = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    ...(post.dek ? { description: post.dek } : {}),
    ...(url ? { mainEntityOfPage: url, url } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
    author: { "@type": "Organization", name: post.businessName },
    publisher: {
      "@type": "Organization",
      name: post.businessName,
      ...(post.baseCity
        ? {
            address: {
              "@type": "PostalAddress",
              addressLocality: post.baseCity,
              addressRegion: post.baseState,
              addressCountry: "US",
            },
          }
        : {}),
    },
    ...(post.town
      ? { areaServed: { "@type": "City", name: post.town, ...(post.state ? { addressRegion: post.state } : {}) } }
      : {}),
  };

  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}
