import type { Metadata } from "next";

import { DemoExperience } from "@/components/demo-experience";
import { demoToday } from "@/lib/demo-job";

export const metadata: Metadata = {
  title: "Demo | Volteira",
  description:
    "Walk a sample electrical job through Volteira, from the estimate to the invoice. No account needed, and nothing is saved.",
};

// Rendered per request, like every page here, so the sample job's dates are
// counted from today rather than from the day the site was built.
export const dynamic = "force-dynamic";

/**
 * The demo: open to anybody (public-paths.ts), and reading and writing
 * nothing. Today's date is the only thing the server hands it, worked out once
 * here so the page and the browser that takes it over say the same dates.
 */
export default function DemoPage() {
  return <DemoExperience todayIso={demoToday(new Date())} />;
}
