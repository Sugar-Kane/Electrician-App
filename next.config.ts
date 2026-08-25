import type { NextConfig } from "next";

/**
 * Nothing here may be framed by another site.
 *
 * The public booking page collects a home address and hands off to Stripe, and
 * it carries the text-message consent checkbox an A2P campaign is reviewed
 * against. Framed on someone else's domain, that checkbox can be overlaid or
 * hidden, and Volteira could no longer say what the customer actually saw when
 * they consented. The dashboard has the usual clickjacking reasons.
 *
 * A tenant who wants the form on their own site links to it. If per-tenant
 * embedding is ever offered, it belongs here as an explicit origin allowlist,
 * not as the absence of a header.
 *
 * Vercel's preview comments UI frames the deployment, so previews allow it and
 * production does not.
 */
const isPreviewDeployment = process.env.VERCEL_ENV === "preview";
const frameAncestors = isPreviewDeployment
  ? "'self' https://vercel.live"
  : "'none'";

const nextConfig: NextConfig = {
  turbopack: {
    root: process.cwd(),
  },
  experimental: {
    /*
     * How long a page already fetched stays usable without going back for it.
     *
     * The default for a dynamic page is zero — nothing is kept — so tapping
     * Jobs, then Home, then Jobs again fetched the same page twice inside ten
     * seconds. Every page in this app is `force-dynamic`, so that default
     * applied to all of them.
     *
     * Twenty seconds rather than the thirty this used to default to. It is long
     * enough to cover somebody moving between tabs and back, and short enough
     * that a booking request answered on one screen is not still showing as
     * waiting on the next. Anything that writes calls `revalidatePath`, which
     * clears this immediately — so a stale page is only ever one somebody else
     * changed.
     */
    staleTimes: {
      dynamic: 20,
      static: 180,
    },
    serverActions: {
      /*
       * Server Actions cap request bodies at 1MB by default, and the account
       * page posts a profile photo through one. A photo off a phone is three to
       * five megabytes, so the framework rejected the request before the action
       * ran and the user saw a broken page rather than the size message the
       * action was ready to give them.
       *
       * 4MB rather than more: the platform refuses request bodies over about
       * 4.5MB whatever is set here, so a larger number would only move the
       * failure somewhere this app cannot phrase an error for. The avatar
       * upload is capped below this, so its own message always wins.
       *
       * Job photos do not come through here at all — they go from the browser
       * straight to storage, which is the only way a 12MP camera works at all.
       */
      bodySizeLimit: "4mb",
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: `frame-ancestors ${frameAncestors}`,
          },
          {
            // Ignored by browsers that honor frame-ancestors; kept for the ones
            // that do not.
            key: "X-Frame-Options",
            value: isPreviewDeployment ? "SAMEORIGIN" : "DENY",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
