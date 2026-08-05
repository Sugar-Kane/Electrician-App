import type { NextConfig } from "next";

/**
 * Nothing here may be framed by another site.
 *
 * The public booking page collects a home address and hands off to Stripe, and
 * it carries the text-message consent checkbox an A2P campaign is reviewed
 * against. Framed on someone else's domain, that checkbox can be overlaid or
 * hidden, and Volterra could no longer say what the customer actually saw when
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
