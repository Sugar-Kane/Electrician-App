import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, CreditCard, TriangleAlert, Wrench } from "lucide-react";

import { keepOneRequest, markDistinct } from "@/app/booking-requests/actions";
import { FieldPageShell } from "@/components/field-page-shell";
import { Banner } from "@/components/ui/banner";
import { keepOne } from "@/lib/booking-duplicates";
import { isOpenRequest } from "@/lib/booking-queue";
import { getBookingRequests, hideable, type BookingRequest } from "@/lib/booking-requests";

export const metadata: Metadata = { title: "Same person twice? | Volteira" };

export const dynamic = "force-dynamic";

const SOURCE_LABELS: Record<string, string> = {
  sms: "Text",
  voice: "Phone call",
  web: "Booking page",
  owner: "Entered by you",
};

const STATUS_LABELS: Record<string, string> = {
  new: "Waiting on you",
  needs_review: "Waiting on you",
  awaiting_payment: "Waiting on payment",
  safety_escalated: "Safety escalated",
  scheduled: "Scheduled",
  confirmed: "Booked and paid",
  dismissed: "Dismissed",
  canceled: "Canceled",
  expired: "Expired",
};

function Candidate({ request, group }: { request: BookingRequest; group: BookingRequest[] }) {
  const choice = keepOne(group.map(hideable), request.id);
  const money = request.paymentCount > 0 || Boolean(request.depositPaidAt) || Boolean(request.paymentIntentId);
  return (
    <div className="flex flex-col rounded-control border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-semibold ${
            isOpenRequest(request.status) ? "border-caution/30 bg-caution-bg text-caution" : "border-line text-ink-muted"
          }`}
        >
          {STATUS_LABELS[request.status] ?? request.status}
        </span>
        <span className="inline-flex min-h-7 items-center rounded-full border border-line px-2.5 text-[10px] font-semibold text-ink-muted">
          {request.origin === "website" ? "From your website" : (SOURCE_LABELS[request.source] ?? "Text")}
        </span>
        {request.jobId ? (
          <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-positive/30 bg-positive-bg px-2.5 text-[10px] font-semibold text-positive">
            <Wrench className="h-3 w-3" aria-hidden /> Has a job
          </span>
        ) : null}
        {money ? (
          <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-positive/30 bg-positive-bg px-2.5 text-[10px] font-semibold text-positive">
            <CreditCard className="h-3 w-3" aria-hidden /> Money taken
          </span>
        ) : null}
      </div>
      <p className="mt-2 text-sm font-semibold">{request.contactName || "Unnamed"}</p>
      <p className="text-xs text-ink-muted">
        {request.phone}
        {request.email ? ` · ${request.email}` : ""}
      </p>
      <p className="mt-1 text-xs text-ink-faint">Arrived {request.receivedLabel}</p>
      <p className="mt-2 flex-1 text-sm leading-6 text-ink-muted">{request.description}</p>
      {request.address ? <p className="mt-1 text-xs text-ink-muted">{request.address}</p> : null}
      {request.arrivalWindow ? <p className="mt-1 text-xs text-brand">Window: {request.arrivalWindow}</p> : null}

      <div className="mt-3 border-t border-line pt-3">
        {choice.ok ? (
          <form action={keepOneRequest}>
            <input type="hidden" name="keepId" value={request.id} />
            {choice.hide.map((other) => (
              <input key={other.id} type="hidden" name="otherId" value={other.id} />
            ))}
            <button
              type="submit"
              className="tap-target inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-chip bg-brand px-4 text-xs font-semibold text-on-brand"
            >
              <Check className="h-4 w-4" aria-hidden /> Keep this one
            </button>
          </form>
        ) : (
          <p className="flex items-start gap-1.5 text-xs leading-5 text-ink-muted">
            <TriangleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-caution" aria-hidden />
            {choice.refusal}
          </p>
        )}
      </div>
    </div>
  );
}

/**
 * Requests that look like one person asking more than once, side by side.
 *
 * Keeping one hides the rest as its duplicates: not deleted, nobody texted,
 * and each can be brought back from History. One with a job or money behind it
 * is never hidden, so it can only ever be the one kept.
 */
export default async function BookingDuplicatesPage({
  searchParams,
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  const [queue, query] = await Promise.all([getBookingRequests(), searchParams]);
  if (queue.requiresLogin) redirect("/login?next=/booking-requests/duplicates");

  return (
    <FieldPageShell
      title="Same person twice?"
      eyebrow="Booking requests"
      description="Requests from the same phone number or email within three days of each other."
      backHref="/booking-requests"
    >
      {query.saved ? <Banner tone="positive" className="mb-4">{query.saved}</Banner> : null}
      {query.error ? <Banner tone="critical" className="mb-4">{query.error}</Banner> : null}

      {queue.duplicates.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center">
          <Check className="mx-auto h-6 w-6 text-positive" aria-hidden />
          <p className="mt-2 text-sm font-semibold">Nothing looks doubled up</p>
          <Link href="/booking-requests" className="mt-2 inline-flex min-h-11 items-center text-sm font-semibold text-brand">
            Back to Booking requests
          </Link>
        </div>
      ) : (
        <div className="space-y-5">
          <p className="px-1 text-sm leading-6 text-ink-muted">
            Keep the one you&rsquo;ll answer. The others are hidden as its duplicates: not deleted, nobody is texted,
            and you can bring any back from History.
          </p>
          {queue.duplicates.map((group) => (
            <section key={group.map((request) => request.id).join("-")} className="rounded-panel border border-line p-3">
              <div className="grid gap-3 md:grid-cols-2">
                {group.map((request) => (
                  <Candidate key={request.id} request={request} group={group} />
                ))}
              </div>
              <form action={markDistinct} className="mt-3 text-center">
                {group.map((request) => (
                  <input key={request.id} type="hidden" name="requestId" value={request.id} />
                ))}
                <button type="submit" className="tap-target inline-flex min-h-11 items-center px-3 text-xs font-semibold text-ink-muted underline underline-offset-2">
                  They&rsquo;re different requests, keep them all
                </button>
              </form>
            </section>
          ))}
        </div>
      )}
    </FieldPageShell>
  );
}
