import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { FrontPage } from "@/components/front-page";
import { StartAtTop } from "@/components/start-at-top";
import { todayInZone } from "@/lib/calendar";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { attentionItems, openBookingRequests, unassignedToday } from "@/lib/dashboard-focus";
import { getBookingRequests } from "@/lib/booking-requests";
import { followUps, lateJobs } from "@/lib/follow-ups";
import { getInventory, getInvoices, getJobs, getUnbilledWork } from "@/lib/job-data";
import { currentUser } from "@/lib/request-context";
import { listSiteVideos } from "@/lib/site-video-data";

export const dynamic = "force-dynamic";

/**
 * Nobody signed in. Without a backend configured there is nobody to sign in
 * as, and the demo dashboard is the only thing a local copy can show, so that
 * case keeps it.
 */
async function signedOut(): Promise<boolean> {
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) return false;
  return !(await currentUser());
}

export default async function Page({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // A visitor gets the front page, which says what Volteira does and how to
  // get in. Somebody signed in can see it too, from the support console's
  // link, with a way back to their own dashboard.
  //
  // Most visitors never reach this: the proxy serves them the same page built
  // ahead of time (app/welcome). This is for that preview, and for a session
  // the proxy still saw that has since gone.
  const visitor = await signedOut();
  const { view } = await searchParams;
  if (visitor || view === "front") {
    // Handed over unwaited, so the page is drawn at once and the videos arrive
    // into their own section.
    return <FrontPage videos={listSiteVideos()} preview={!visitor} />;
  }

  const [snapshot, { jobs }, { invoices }, stock, bookings, unbilled] = await Promise.all([
    getDashboardSnapshot(),
    getJobs(),
    getInvoices(),
    getInventory(),
    getBookingRequests(),
    getUnbilledWork(),
  ]);

  // Signed in, with no business yet: part-way through signing up. The demo
  // figures this would otherwise show — somebody else's name and business —
  // read as another person's account, so they finish setting up instead.
  if (snapshot.requiresOnboarding) redirect("/onboarding");

  const today = todayInZone(snapshot.timezone);
  // One clock for the page, so the list and the status pills agree about
  // what is late.
  const now = new Date();

  // Counted here rather than inside the shell so the component stays a
  // rendering concern and the arithmetic stays testable.
  const attention = attentionItems({
    bookingRequests: openBookingRequests(bookings.requests),
    overdueInvoices: invoices.filter((invoice) => invoice.status === "Overdue").length,
    unsentInvoices: invoices.filter(
      (invoice) => invoice.status !== "Paid" && !invoice.sentLabel,
    ).length,
    // Reorder point is what the business itself said "low" means.
    lowStock: stock.filter((item) => item.quantity <= 0).length,
    // Only work that still needs somebody sent to it. A job finished by
    // whoever happened to be there, with the technician field never filled in,
    // used to sit here in amber until midnight with nothing that could clear it.
    unassignedToday: unassignedToday(jobs, today),
  });

  return (
    <>
      <StartAtTop />
      <DashboardShell
        snapshot={snapshot}
        jobs={jobs}
        attention={attention}
        followUps={followUps({ jobs, unbilled, now, timeZone: snapshot.timezone })}
        late={lateJobs(jobs, now)}
      />
    </>
  );
}
