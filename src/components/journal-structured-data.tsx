import type { JournalPost } from "@/lib/journal-data";
import { safeJsonLd } from "@/lib/json-ld";

export function JournalStructuredData({
  post,
  url,
  /** The journal index this post sits under, for the breadcrumb trail. */
  indexUrl = "",
}: {
  post: JournalPost;
  url: string;
  indexUrl?: string;
}) {
  /*
   * The business, as one entity rather than three loose strings.
   *
   * `Electrician` is a subtype of `LocalBusiness`, so declaring both makes the
   * publisher of these posts the same thing as the company that serves the
   * area they are about. That connection is what a local result is built on;
   * a bare `Organization` name is not enough to make it.
   *
   * `address` carries only locality, region and postal code, because
   * `base_address_line_1` and `license_number` are null on this record. An
   * invented street or licence number in markup a search engine reads is worse
   * than an absent one.
   */
  const publisher = {
    "@type": ["Organization", "Electrician"],
    name: post.businessName,
    ...(post.businessPhone ? { telephone: post.businessPhone } : {}),
    ...(indexUrl ? { url: indexUrl } : {}),
    ...(post.baseCity
      ? {
          address: {
            "@type": "PostalAddress",
            addressLocality: post.baseCity,
            ...(post.baseState ? { addressRegion: post.baseState } : {}),
            ...(post.basePostalCode ? { postalCode: post.basePostalCode } : {}),
            addressCountry: "US",
          },
        }
      : {}),
    ...(post.town
      ? {
          areaServed: {
            "@type": "City",
            name: post.town,
            ...(post.state ? { addressRegion: post.state } : {}),
          },
        }
      : {}),
  };

  const article = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: post.title,
    ...(post.dek ? { description: post.dek } : {}),
    ...(url ? { mainEntityOfPage: url, url } : {}),
    ...(post.publishedAt ? { datePublished: post.publishedAt } : {}),
    ...(post.updatedAt ? { dateModified: post.updatedAt } : {}),
    author: publisher,
    publisher,
    ...(post.town
      ? {
          areaServed: {
            "@type": "City",
            name: post.town,
            ...(post.state ? { addressRegion: post.state } : {}),
          },
        }
      : {}),
  };

  /*
   * The trail, which is what puts a path in a result rather than a bare URL.
   * Emitted only with both URLs, because a breadcrumb missing an item is
   * markup a validator rejects and nothing gains.
   */
  const breadcrumb =
    indexUrl && url
      ? {
          "@context": "https://schema.org",
          "@type": "BreadcrumbList",
          itemListElement: [
            { "@type": "ListItem", position: 1, name: "Work journal", item: indexUrl },
            { "@type": "ListItem", position: 2, name: post.title, item: url },
          ],
        }
      : null;

  return (
    <>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: safeJsonLd(article) }}
      />
      {breadcrumb ? (
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: safeJsonLd(breadcrumb) }}
        />
      ) : null}
    </>
  );
}
