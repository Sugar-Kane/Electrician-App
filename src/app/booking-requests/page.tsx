import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import {
  CalendarPlus,
  Check,
  MessagesSquare,
  PhoneCall,
  ShieldAlert,
  TriangleAlert,
  X,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { getBookingRequests, type BookingRequest } from "@/lib/booking-requests";
import { dismissBookingRequest, scheduleBookingRequest } from "@/app/booking-requests/actions";

export const metadata: Metadata = { title: "Booking requests | Volteira" };

// A queue of things waiting on a person must never be served from a cache.
export const dynamic = "force-dynamic";

const intentStyles: Record<BookingRequest["intent"], { label: string; className: string }> = {
  emergency: { label: "Safety", className: "border-red-400/30 bg-red-400/10 text-red-300" },
  callback: { label: "Callback", className: "border-amber-400/30 bg-amber-400/10 text-amber-300" },
  visit: { label: "Visit", className: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" },
};

function RequestCard({ request }: { request: BookingRequest }) {
  const intent = intentStyles[request.intent];
  const handled = request.status !== "new";

  return (
    <article
      className={`rounded-3xl border p-4 sm:p-5 ${
        request.intent === "emergency"
          ? "border-red-400/25 bg-red-400/[0.04]"
          : "border-white/10 bg-[#0b1b27]"
      } ${handled ? "opacity-60" : ""}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-semibold ${intent.className}`}>
              {intent.label}
            </span>
            {request.urgency === "urgent" ? (
              <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-amber-400/30 bg-amber-400/10 px-2.5 text-[10px] font-semibold text-amber-300">
                <TriangleAlert className="h-3 w-3" aria-hidden /> Urgent
              </span>
            ) : null}
            {handled ? (
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                {request.status === "scheduled" ? "Scheduled" : "Dismissed"}
              </span>
            ) : null}
          </div>
          <h2 className="mt-2 text-base font-semibold">
            {request.contactName || "Unnamed"} · {request.phone}
          </h2>
          <p className="mt-1 text-sm leading-6 text-slate-300">{request.description}</p>
          {request.address ? <p className="mt-1 text-xs text-slate-400">{request.address}</p> : null}
          {request.arrivalWindow ? (
            <p className="mt-1 text-xs text-[#ffc21c]">Window: {request.arrivalWindow}</p>
          ) : null}
          {request.safetyFlags.length > 0 ? (
            <p className="mt-2 flex items-start gap-1.5 text-xs text-red-200">
              <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
              Told to call 911: {request.safetyFlags.join(", ").replace(/_/g, " ")}
            </p>
          ) : null}
        </div>
        <span className="shrink-0 text-[11px] text-slate-500">{request.receivedLabel}</span>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <a
          href={`tel:${request.phone.replace(/[^\d+]/g, "")}`}
          className="tap-target inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-xs font-semibold text-slate-200"
        >
          <PhoneCall className="h-4 w-4" aria-hidden /> Call
        </a>
        {request.conversationId ? (
          <Link
            href={`/messages/${request.conversationId}`}
            className="tap-target inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 text-xs font-semibold text-slate-200"
          >
            <MessagesSquare className="h-4 w-4" aria-hidden /> Read the thread
          </Link>
        ) : null}
        {request.jobId ? (
          <span className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/[0.06] px-3.5 text-xs font-semibold text-emerald-300">
            <Check className="h-4 w-4" aria-hidden /> Job created
          </span>
        ) : null}

        {!handled ? (
          <>
            <form action={scheduleBookingRequest}>
              <input type="hidden" name="requestId" value={request.id} />
              <button
                type="submit"
                className="tap-target inline-flex min-h-11 items-center gap-2 rounded-xl bg-[#ffc21c] px-4 text-xs font-semibold text-[#071723]"
              >
                <CalendarPlus className="h-4 w-4" aria-hidden />
                {request.arrivalWindow ? "Create the job" : "Create an unscheduled job"}
              </button>
            </form>
            <form action={dismissBookingRequest}>
              <input type="hidden" name="requestId" value={request.id} />
              <button
                type="submit"
                className="tap-target inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3.5 text-xs font-semibold text-slate-400"
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

  const open = queue.requests.filter((request) => request.status === "new");
  const handled = queue.requests.filter((request) => request.status !== "new");

  return (
    <FieldPageShell
      title="Booking requests"
      eyebrow="From text messages"
      description="What customers asked for by text. A visit they accepted is already on the schedule; everything here is waiting on you."
    >
      {query.saved ? (
        <p role="status" className="mb-4 flex items-start gap-2 rounded-2xl border border-emerald-400/20 bg-emerald-400/[0.07] p-4 text-sm text-emerald-200">
          <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {query.saved}
        </p>
      ) : null}
      {query.error ? (
        <p role="alert" className="mb-4 flex items-start gap-2 rounded-2xl border border-red-400/20 bg-red-400/[0.07] p-4 text-sm text-red-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {query.error}
        </p>
      ) : null}

      {open.length === 0 && handled.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/15 p-10 text-center">
          <MessagesSquare className="mx-auto h-7 w-7 text-slate-600" aria-hidden />
          <h2 className="mt-3 text-lg font-semibold">No requests yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-400">
            When a customer texts the business number, what they asked for shows up here — a callback
            to return, or a visit they have already accepted.
          </p>
        </div>
      ) : null}

      {open.length > 0 ? (
        <section className="space-y-3" aria-labelledby="open-requests">
          <h2 id="open-requests" className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Waiting on you ({open.length})
          </h2>
          {open.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </section>
      ) : null}

      {handled.length > 0 ? (
        <section className="mt-6 space-y-3" aria-labelledby="handled-requests">
          <h2 id="handled-requests" className="px-1 text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">
            Handled
          </h2>
          {handled.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </section>
      ) : null}
    </FieldPageShell>
  );
}
