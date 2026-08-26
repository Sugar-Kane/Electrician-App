/**
 * Where a post lives, and which of its addresses is the real one.
 *
 * A post is reachable at two URLs and that is deliberate, but only one of them
 * may be the canonical or the SEO splits in half and neither address ranks:
 *
 *   volteira.com/journal/pacific-plains-electric/why-does-my-dryer-trip
 *   blog.pacificplainselectric.com/journal/why-does-my-dryer-trip
 *
 * The second is better and is not available yet. `organization_domains` is
 * empty — nobody has pointed a hostname at us — so today every canonical is on
 * volteira.com. The day a business verifies a subdomain, the canonical moves
 * with it and the accumulated value follows, rather than the business having to
 * start again on their own name.
 *
 * On a tenant host the org slug is dropped from the path, because that hostname
 * already identifies exactly one business. `proxy.ts` rewrites every non-API
 * path there, so `/journal/x` arrives as `/book/by-host/journal/x`.
 *
 * Import-free, so the awkward cases can be tested without a request.
 */

/** An origin with no trailing slash, or "" if it is not usable as one. */
export function originOf(value: string | null | undefined): string {
  const trimmed = (value ?? "").trim().replace(/\/+$/, "");
  if (!trimmed) return "";
  if (!/^https?:\/\/[^/\s]+$/i.test(trimmed)) return "";
  return trimmed;
}

/** A hostname reduced to one comparable form, or "" if it is not one. */
export function hostOf(value: string | null | undefined): string {
  const host = (value ?? "").trim().toLowerCase();
  return /^[a-z0-9.-]+$/.test(host) ? host : "";
}

/**
 * The origin a post's canonical URL is built on.
 *
 * A verified tenant hostname wins. Falls back to the app's own origin, and
 * then to "" — a relative canonical is better than one pointing at localhost,
 * and callers omit the tag entirely when this is empty.
 */
export function canonicalOrigin(input: {
  appUrl: string | null | undefined;
  /** The hostname this business has verified, or "" for none. */
  tenantHost: string | null | undefined;
}): string {
  const host = hostOf(input.tenantHost);
  if (host) return `https://${host}`;
  return originOf(input.appUrl);
}

/**
 * Which of a post's two addresses gets submitted to crawlers.
 *
 * A post is reachable on both hostnames on purpose, but a sitemap is a claim
 * that a URL is worth indexing, and submitting a URL whose own canonical tag
 * points at a different host is a contradiction a crawler resolves by trusting
 * neither signal. So exactly one of these two may carry any given post, and
 * both answers come from here rather than from a rule written twice.
 *
 * The deciding fact is **verification**, not whether a hostname resolves.
 * `get_booking_page_by_host` matches an `organization_domains` row without
 * looking at `verified_at`, so a domain that is pointed at us but still
 * pending serves real pages — and those pages canonicalise home, because
 * `get_verified_host_for_slug` does check it. Left unguarded, that setup
 * window is one where the tenant sitemap advertises URLs that disown
 * themselves while the product sitemap lists the same posts a second time.
 */
export function appSitemapCarries(verifiedHost: string | null | undefined): boolean {
  return hostOf(verifiedHost) === "";
}

/**
 * The origin a tenant hostname may submit its journal from, or "".
 *
 * Compared against the host the request came in on rather than merely tested
 * for existence: a business can hold several domain rows, and a request
 * arriving on a second, unverified one is not on the address that owns these
 * posts even though the business does have a verified address elsewhere.
 */
export function tenantSitemapOrigin(input: {
  requestHost: string | null | undefined;
  verifiedHost: string | null | undefined;
}): string {
  const verified = hostOf(input.verifiedHost);
  if (!verified) return "";
  return verified === hostOf(input.requestHost) ? `https://${verified}` : "";
}

/**
 * The path to the journal index.
 *
 * `onTenantHost` is what the visitor typed, not where the canonical points. A
 * link rendered on a tenant page must stay on that hostname, or every internal
 * link bounces the reader onto volteira.com mid-visit.
 */
export function journalIndexPath(orgSlug: string, onTenantHost: boolean): string {
  return onTenantHost ? "/journal" : `/journal/${encodeURIComponent(orgSlug)}`;
}

export function journalPostPath(
  orgSlug: string,
  postSlug: string,
  onTenantHost: boolean,
): string {
  const post = encodeURIComponent(postSlug);
  return onTenantHost ? `/journal/${post}` : `/journal/${encodeURIComponent(orgSlug)}/${post}`;
}

/**
 * The one URL that should be indexed for this post.
 *
 * Always built for the canonical host, never for the host being served: that is
 * the entire job of the tag. A reader who arrived on volteira.com for a business
 * with a verified domain is told the real address is on that domain.
 */
export function canonicalPostUrl(input: {
  appUrl: string | null | undefined;
  tenantHost: string | null | undefined;
  orgSlug: string;
  postSlug: string;
}): string {
  const origin = canonicalOrigin(input);
  if (!origin) return "";
  return `${origin}${journalPostPath(input.orgSlug, input.postSlug, Boolean((input.tenantHost ?? "").trim()))}`;
}

export function canonicalIndexUrl(input: {
  appUrl: string | null | undefined;
  tenantHost: string | null | undefined;
  orgSlug: string;
}): string {
  const origin = canonicalOrigin(input);
  if (!origin) return "";
  return `${origin}${journalIndexPath(input.orgSlug, Boolean((input.tenantHost ?? "").trim()))}`;
}
