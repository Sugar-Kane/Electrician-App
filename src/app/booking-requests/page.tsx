import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarPlus,
  Check,
  ChevronDown,
  MessagesSquare,
  PhoneCall,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getBookingRequests, type BookingRequest } from "@/lib/booking-requests";
import { isOpenRequest } from "@/lib/booking-queue";
import { dismissBookingRequest, scheduleBookingRequest } from "@/app/booking-requests/actions";
import { Banner } from "@/components/ui/banner";

export const metadata: Metadata = { title: "Booking requests | Volteira" };

// A queue of things waiting on a person must never be served from a cache.
export const dynamic = "force-dynamic";

const intentStyles: Record<BookingRequest["intent"], { label: string; className: string }> = {
  emergency: { label: "Safety", className: "border-critical/30 bg-critical-bg text-critical" },
  callback: { label: "Callback", className: "border-caution/30 bg-caution-bg text-caution" },
  visit: { label: "Visit", className: "border-positive/30 bg-positive-bg text-positive" },
};

/**
 * Where the request came from.
 *
 * One table holds all of them now, so the screen has to say which is which:
 * a text booking and a web booking look identical once they are rows, and the
 * difference decides what the customer has already been told.
 */
const SOURCE_LABELS: Record<string, string> = {
  sms: "Text",
  voice: "Phone call",
  web: "Booking page",
  owner: "Entered by you",
};

/** What happened to it, for the ones that are done. */
const HANDLED_LABELS: Record<string, string> = {
  scheduled: "Scheduled",
  confirmed: "Booked and paid",
  dismissed: "Dismissed",
  canceled: "Canceled",
  expired: "Expired",
  awaiting_payment: "Waiting on payment",
  safety_escalated: "Safety escalated",
};

function RequestCard({ request }: { request: BookingRequest }) {
  const intent = intentStyles[request.intent];
  const handled = !isOpenRequest(request.status);

  return (
    <article
      className={`rounded-panel border p-4 sm:p-5 ${
        request.intent === "emergency"
          ? "border-critical/25 bg-critical-bg"
          : "border-line bg-surface"
      } ${handled ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-semibold ${intent.className}`}>
              {intent.label}
            </span>
            {request.urgency === "urgent" ? (
              <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-caution/30 bg-caution-bg px-2.5 text-[10px] font-semibold text-caution">
                <TriangleAlert className="h-3 w-3" aria-hidden /> Urgent
              </span>
            ) : null}
            <span className="inline-flex min-h-7 items-center rounded-full border border-line px-2.5 text-[10px] font-semibold text-ink-muted">
              {SOURCE_LABELS[request.source] ?? "Text"}
            </span>
            {handled ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-ink-faint">
                {HANDLED_LABELS[request.status] ?? request.status}
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-base font-semibold">
            {request.contactName || "Unnamed"} · {request.phone}
          </h2>
          <p className="mt-1 text-sm leading-6 text-ink-muted">{request.description}</p>
          {request.address ? <p className="mt-1 text-xs text-ink-muted">{request.address}</p> : null}
          {request.arrivalWindow ? (
            <p className="mt-1 text-xs text-brand">Window: {request.arrivalWindow}</p>
          ) : null}
          {request.safetyFlags.length > 0 ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-critical">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Told to call 911: {request.safetyFlags.join(", ").replace(/_/g, " ")}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-ink-faint">{request.receivedLabel}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={`tel:${request.phone.replace(/[^\d+]/g, "")}`}
          className="tap-target inline-flex min-h-11 items-center gap-2 rounded-chip border border-line bg-white/[0.03] px-3.5 text-xs font-semibold text-ink"
        >
          <PhoneCall className="h-4 w-4" aria-hidden /> Call
        </a>
        {request.conversationId ? (
          <Link
            href={`/messages/${request.conversationId}`}
            className="tap-target inline-flex min-h-11 items-center gap-2 rounded-chip border border-line bg-white/[0.03] px-3.5 text-xs font-semibold text-ink"
          >
            <MessagesSquare className="h-4 w-4" aria-hidden /> Read the thread
          </Link>
        ) : null}
        {request.jobId ? (
          <span className="inline-flex min-h-11 items-center gap-2 rounded-chip border border-positive/20 bg-positive-bg px-3.5 text-xs font-semibold text-positive">
            <Check className="h-4 w-4" aria-hidden /> Job created
          </span>
        ) : null}

        {!handled ? (
          <>
            <form action={scheduleBookingRequest}>
              <input type="hidden" name="requestId" value={request.id} />
              <button
                type="submit"
                className="tap-target inline-flex min-h-11 items-center gap-2 rounded-chip bg-brand px-4 text-xs font-semibold text-on-brand"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
                {request.arrivalWindow ? "Create the job" : "Create an unscheduled job"}
              </button>
            </form>
            <form action={dismissBookingRequest}>
              <input type="hidden" name="requestId" value={request.id} />
              <button
                type="submit"
                className="tap-target inline-flex min-h-11 items-center gap-2 rounded-chip border border-line px-3.5 text-xs font-semibold text-ink-muted"
              >
                <X className="h-4 w-4" aria-hidden /> Dismiss
              </button>
            </form>
          </>
        ) : null}
      </div>
    </article>
  );
}

export default async function BookingRequestsPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [queue, query] = await Promise.all([getBookingRequests(), searchParams]);
  if (queue.requiresLogin) redirect("/login?next=/booking-requests");

  const { open, handled, agedOut } = queue;

  return (
    <FieldPageShell
      title="Booking requests"
      eyebrow="Requests for work"
      description="What customers have asked for, however they asked — by text, by phone, or through your booking page. A visit they accepted is already on the schedule."
    >
      {query.saved ? (
        <Banner tone="positive" className="mb-4">{query.saved}</Banner>
      ) : null}
      {query.error ? (
        <Banner tone="critical" className="mb-4">{query.error}</Banner>
      ) : null}

      {open.length === 0 && handled.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-10 text-center">
          <MessagesSquare className="mx-auto h-7 w-7 text-ink-faint" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">No requests yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-ink-muted">
            When somebody texts the business number, calls, or books through your page, what they
            asked for shows up here — a callback to return, or a visit they have already accepted.
          </p>
        </div>
      ) : null}

      {/*
        The page used to render nothing between the header and the handled
        list when there was nothing waiting. So somebody opening it saw one
        request card and reasonably read it as a request needing an answer,
        when in fact it was history and the answer was given days ago.
      */}
      {open.length === 0 && handled.length > 0 ? (
        <div className="rounded-panel border border-dashed border-line p-6 text-center">
          <Check className="mx-auto h-6 w-6 text-positive" aria-hidden />
          <p className="mt-2 text-sm font-semibold">Nothing waiting on you</p>
          <p className="mt-1 text-sm text-ink-muted">
            The rest have already been answered. They are folded away below.
          </p>
        </div>
      ) : null}

      {open.length > 0 ? (
        <section className="space-y-3" aria-labelledby="open-requests">
          <h2 id="open-requests" className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            Waiting on you ({open.length})
          </h2>
          {open.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </section>
      ) : null}

      {/*
        Folded away, and closed to start with.
        
        This list used to sit open underneath the queue and keep everything
        forever, so within a fortnight the page was mostly history — and the
        requests actually needing an answer were the small part at the top.
        A `<details>` rather than a button and some state: it works before any
        JavaScript arrives, which on a van's signal is most of the time.
      */}
      {handled.length > 0 ? (
        <details className="mt-6 rounded-panel border border-line bg-surface">
          <summary className="tap-target flex cursor-pointer list-none items-center justify-between gap-2 px-4 text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">
            <span>Already handled ({handled.length})</span>
            <ChevronDown className="h-4 w-4 shrink-0" aria-hidden />
          </summary>
          <div className="space-y-3 p-3 pt-0">
            {handled.map((request) => (
              <RequestCard key={request.id} request={request} />
            ))}
          </div>
        </details>
      ) : null}

      {/*
        Said out loud rather than left as a silent gap. A page that quietly
        drops rows is a page somebody stops trusting.
      */}
      {agedOut > 0 ? (
        <p className="mt-3 px-1 text-center text-xs text-ink-faint">
          {agedOut} older {agedOut === 1 ? "request has" : "requests have"} dropped off after a
          week. Anything still waiting on you stays here however old it is.
        </p>
      ) : null}
    </FieldPageShell>
  );
}
