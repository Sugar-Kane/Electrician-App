import type { MetadataRoute } from "next";

import { originOf } from "@/lib/journal-urls";

/**
 * robots.txt for the product's own domain, which also did not exist.
 *
 * Without it a crawler is free to walk the whole app: the login screen, the
 * booking-payment pages behind their tokens, the API routes Twilio and Stripe
 * call. None of that is secret and none of it should be in an index either.
 *
 * The journal is the one thing here that wants crawling, so the rule is a
 * disallow list rather than a blanket allow. `/book/` is excluded because those
 * pages already carry `noindex`, and saying it twice costs nothing.
 */

export const revalidate = 3600;

export default function robots(): MetadataRoute.Robots {
  const origin = originOf(process.env.NEXT_PUBLIC_APP_URL);

  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/journal/"],
        disallow: ["/api/", "/booking/", "/book/", "/invite/", "/auth/", "/login", "/signup"],
      },
    ],
    ...(origin ? { sitemap: `${origin}/sitemap.xml`, host: origin } : {}),
  };
}
