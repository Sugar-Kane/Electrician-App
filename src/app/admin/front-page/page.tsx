import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";

import { SiteVideoManager } from "@/components/site-video-manager";
import { listSiteVideos, videoStorageConnected } from "@/lib/site-video-data";

export const metadata: Metadata = {
  title: "Front page | Volteira support",
  robots: { index: false, follow: false },
};

/**
 * The walkthrough videos on volteira.com's front page.
 *
 * Here rather than in a business's own settings because the front page is
 * Volteira's, not any one business's.
 */
export default async function AdminFrontPage() {
  const videos = await listSiteVideos();

  return (
    <div className="space-y-5">
      <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h1 className="text-xl font-semibold">Front page videos</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-ink-muted">
          These play on the front page of volteira.com for anybody who is not signed in, in this order. Visitors
          press play on one and cycle through the rest.
        </p>
        <Link
          href="/?view=front"
          className="mt-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-semibold text-brand"
        >
          See the front page <ExternalLink className="h-4 w-4" aria-hidden />
        </Link>
      </section>

      <SiteVideoManager videos={videos} connected={videoStorageConnected()} />
    </div>
  );
}
