import { redirect } from "next/navigation";

import { DashboardShell } from "@/components/dashboard-shell";
import { FrontPage } from "@/components/front-page";
import { StartAtTop } from "@/components/start-at-top";
import { todayInZone } from "@/lib/calendar";
import { getDashboardSnapshot } from "@/lib/dashboard";
import { getBuyList } from "@/lib/buy-list-data";
import { getBookingRequests } from "@/lib/booking-requests";
import { followUps, lateJobs } from "@/lib/follow-ups";
import { needsActionFromInputs } from "@/lib/needs-action";
import { getAgreementStates, getInventory, getJobs, getUnbilledWork } from "@/lib/job-data";
import { currentContext, currentUser } from "@/lib/request-context";
import { getSupabaseAdmin } from "@/lib/supabase/admin";
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
  const { money } = snapshot;

  // "Needs your action": the same function the Tasks page and ChatGPT's daily
  // list use (needs-action.ts), here fed what this page has already loaded.
  const attention = needsActionFromInputs({
    jobs,
    agreements,
    unbilled,
    stockQuantities: stock.map((item) => item.quantity),
    buyStatuses: buyList.map((item) => item.status),
    bookingStatuses: bookings.requests.map((request) => request.status),
    money: { overdueCount: money.overdueCount, overdueCents: money.overdueCents, draftCount: money.draftCount, draftCents: money.draftCents },
    today,
    timeZone: snapshot.timezone,
    now,
  }).items;

  // The owner of a real business who has not connected ChatGPT yet is told,
  // once, at the bottom of the day, that they can.
  const context = snapshot.source === "supabase" ? await currentContext() : null;
  let suggestChatGpt = false;
  if (context?.role === "owner") {
    const { count } = await getSupabaseAdmin()
      .from("mcp_business_credentials")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", context.organizationId)
      .is("revoked_at", null)
      .gt("expires_at", new Date().toISOString());
    suggestChatGpt = (count ?? 0) === 0;
  }

  return (
    <>
      <StartAtTop />
      <DashboardShell
        snapshot={snapshot}
        jobs={jobs}
        attention={attention}
        followUps={loose}
        late={lateJobs(jobs, now)}
        suggestChatGpt={suggestChatGpt}
      />
    </>
  );
}
