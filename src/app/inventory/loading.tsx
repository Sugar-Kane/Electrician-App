import { PageSkeleton } from "@/components/ui/page-skeleton";

/**
 * Shown the moment a link in this section is tapped, while the page is read.
 * Without its own boundary a tap here left the old page on screen, looking
 * ignored, until the new one had arrived whole.
 */
export default function Loading() {
  return <PageSkeleton rows={4} />;
}
