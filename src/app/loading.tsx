"use client";

import { usePathname } from "next/navigation";

import { PageSkeleton } from "@/components/ui/page-skeleton";

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

export default function Loading() {
  const pathname = usePathname();
  if (NO_SKELETON.has(pathname)) return null;
  return <PageSkeleton rows={4} />;
}
