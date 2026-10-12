import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { FrontPage } from "@/components/front-page";
import { StartAtTop } from "@/components/start-at-top";
import { todayInZone } from "@/lib/calendar";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { stillToGet } from "@/lib/buy-list";
import { getBuyList } from "@/lib/buy-list-data";
import { attentionItems, openBookingRequests, unassignedToday } from "@/lib/dashboard-focus";
import { getBookingRequests } from "@/lib/booking-requests";
import { followUps, isPastVisit, lateJobs } from "@/lib/follow-ups";
import { getAgreementStates, getInventory, getJobs, getUnbilledWork } from "@/lib/job-data";
import { jobStage } from "@/lib/job-stage";
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

  const [snapshot, { jobs }, stock, bookings, unbilled, agreements, buyList] = await Promise.all([
    getDashboardSnapshot(),
    getJobs(),
    getInventory(),
    getBookingRequests(),
    getUnbilledWork(),
    getAgreementStates(),
    getBuyList(),
  ]);

  // Signed in, with no business yet: part-way through signing up. The demo
  // figures this would otherwise show — somebody else's name and business —
  // read as another person's account, so they finish setting up instead.
  if (snapshot.requiresOnboarding) redirect("/onboarding");

  const today = todayInZone(snapshot.timezone);
  // One clock for the page, so the list and the status pills agree about
  // what is late.
  const now = new Date();

  const loose = followUps({ jobs, unbilled, now, timeZone: snapshot.timezone });
  const toInvoice = loose.filter((item) => item.kind === "not_invoiced");
  // Quotes still to price: the jobs list's "Needs estimate", read the same way.
  const quotesToPrice = jobs.filter(
    (job) =>
      jobStage({
        status: job.status,
        scheduled: Boolean(job.startsAt),
        kindOfWork: job.kindOfWork,
        agreement: agreements[job.id] ?? null,
      }) === "needs_estimate",
  ).length;
  const toGet = buyList.filter(stillToGet);
  const { money } = snapshot;

  // Counted here rather than inside the shell so the component stays a
  // rendering concern and the arithmetic stays testable. Each count is the
  // length of the list its link opens.
  const attention = attentionItems({
    bookingRequests: openBookingRequests(bookings.requests),
    pastVisits: loose.filter(isPastVisit).length,
    overdueInvoices: money.overdueCount,
    overdueCents: money.overdueCents,
    unsentInvoices: money.draftCount,
    unsentCents: money.draftCents,
    toInvoice: toInvoice.length,
    toInvoiceCents: toInvoice.reduce((sum, item) => sum + (unbilled[item.jobNumber] ?? 0), 0),
    awaitingApproval: money.awaitingApprovalCount,
    awaitingApprovalCents: money.awaitingApprovalCents,
    quotesToPrice,
    buyList: {
      toBuy: toGet.filter((item) => item.status === "need_to_buy").length,
      ordered: toGet.filter((item) => item.status === "ordered").length,
      ready: toGet.filter((item) => item.status === "ready_for_pickup").length,
    },
    // Nothing left on hand, which is what the label says.
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
        followUps={loose}
        late={lateJobs(jobs, now)}
      />
    </>
  );
}
