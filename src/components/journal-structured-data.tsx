import type { JournalPost } from "@/lib/journal-data";

/**
 * What a search engine is told this page is.
 *
 * `areaServed` is the part that earns local results, and it is the reason to
 * bother: a post about tripping breakers is one of thousands, and a post about
 * tripping breakers by an electrician who works in this town is the one a
 * person in this town should be shown.
 *
 * ## The escaping, which is not optional
 *
 * `JSON.stringify` escapes quotes and backslashes and leaves `<` alone. Inside
 * a `<script>` element the parser is not reading JSON, it is looking for the
 * closing tag, so the sequence `</script>` anywhere in a string ends the
 * element early and everything after it becomes markup the browser runs.
 *
 * Every field here is either model-written or edited by asking a model, and the
 * model's input includes text a customer typed. That is a path from a text
 * message to script execution in a stranger's browser, on a public page, and
 * escaping `<` closes it. `&` and the line separators go too: the first stops
 * an entity being reassembled, the last two are literal newlines to a
 * JavaScript parser but not to JSON.
 */
function safeJsonLd(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

export function JournalStructuredData({ post, url }: { post: JournalPost; url: string }) {
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
      ? {
          areaServed: {
            "@type": "City",
            name: post.town,
            ...(post.state ? { addressRegion: post.state } : {}),
          },
        }
      : {}),
  };

  return (
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(data) }} />
  );
}
