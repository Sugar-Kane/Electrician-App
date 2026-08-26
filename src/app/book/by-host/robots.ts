import type { MetadataRoute } from "next";
import { headers } from "next/headers";

/**
 * robots.txt on an electrician's own domain.
 *
 * Reached the same way the sitemap beside it is: the proxy rewrites every
 * non-API path on a tenant hostname, and `.txt` is not one of the extensions
 * its matcher excludes.
 *
 * The booking form stays out of the index, which is the rule that has always
 * applied on these hostnames and is why the page carries `noindex`. The journal
 * is the exception, and the sitemap points at itself on this host rather than
 * on ours, because these URLs are the canonical ones.
 */

export const revalidate = 3600;

export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("x-booking-host") ?? "";

  return {
    rules: [{ userAgent: "*", allow: ["/journal"], disallow: ["/api/", "/booking/"] }],
    ...(host ? { sitemap: `https://${host}/sitemap.xml`, host } : {}),
  };
}
