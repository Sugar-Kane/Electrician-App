"use client";

import { usePathname } from "next/navigation";

import { PageSkeleton } from "@/components/ui/page-skeleton";
import { isPublicPath } from "@/lib/public-paths";

/**
 * The pages a stranger opens first, which show no skeleton.
 *
 * This file is the loading state of every page without one of its own, and its
 * skeleton is the app's: a sidebar and a column of cards. In front of the
 * front page (served from /welcome) or the demo it was the wrong site
 * appearing for a moment — React holds a painted fallback for 300ms — before
 * the right one replaced it. Both are built ahead of time and arrive whole, so
 * until the browser has drawn them the empty canvas is the honest thing to
 * show.
 */
const NO_SKELETON = new Set(["/welcome", "/demo"]);

/**
 * What a customer sees while their page loads.
 *
 * The contract they were texted, the deposit page, an invitation, the journal,
 * a business's terms: all of them fell back to the app's skeleton above, so a
 * homeowner opening a link to sign a contract saw a sidebar and a dashboard's
 * cards flash past first — somebody else's software, for a moment, before the
 * page about their job. These are read from the database when they open, so
 * there is a real wait to fill; it is filled with the page's own background
 * and a plain column, and nothing that belongs to the business's side.
 */
function CustomerPageLoading() {
  return (
    <main className="min-h-screen bg-canvas px-4 py-6 text-ink" aria-busy="true" aria-label="Loading">
      <div className="mx-auto max-w-2xl animate-pulse space-y-4">
        <div className="h-6 w-40 rounded bg-white/[0.06]" />
        <div className="h-28 rounded-panel bg-white/[0.06]" />
        <div className="h-48 rounded-panel bg-white/[0.04]" />
      </div>
    </main>
  );
}

export default function Loading() {
  const pathname = usePathname();
  if (NO_SKELETON.has(pathname)) return null;
  // The home page is the dashboard for somebody signed in, so it keeps the
  // app's skeleton; a visitor there is served the front page, built ahead.
  if (pathname !== "/" && isPublicPath(pathname)) return <CustomerPageLoading />;
  return <PageSkeleton rows={4} />;
}
