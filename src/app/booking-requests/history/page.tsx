import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check, EyeOff, RotateCcw, Search } from "lucide-react";

import { restoreRequest } from "@/app/booking-requests/actions";
import { FieldPageShell } from "@/components/field-page-shell";
import { SpanishBadge } from "@/components/language-badge";
import { Banner } from "@/components/ui/banner";
import { DateField } from "@/components/ui/date-field";
import { SelectField } from "@/components/ui/select-field";
import { notServiceLabel } from "@/lib/booking-duplicates";
import { isOpenRequest } from "@/lib/booking-queue";
import { getBookingHistory, type BookingRequest } from "@/lib/booking-requests";

export const metadata: Metadata = { title: "Booking history | Volteira" };

export const dynamic = "force-dynamic";

const SOURCES = [
  { value: "", label: "Any way" },
  { value: "sms", label: "Text" },
  { value: "voice", label: "Phone call" },
  { value: "web", label: "Booking page" },
  { value: "owner", label: "Entered by you" },
];

const STATES = [
  { value: "", label: "Everything" },
  { value: "waiting", label: "Waiting on you" },
  { value: "handled", label: "Handled" },
  { value: "hidden", label: "Hidden" },
];

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

const SOURCE_LABELS: Record<string, string> = Object.fromEntries(SOURCES.filter((entry) => entry.value).map((entry) => [entry.value, entry.label]));

function HistoryCard({ request }: { request: BookingRequest }) {
  const hidden = Boolean(request.archivedAt);
  return (
    <article className={`rounded-panel border border-line bg-surface p-4 ${hidden ? "opacity-80" : ""}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {hidden ? (
              <span className="inline-flex min-h-7 items-center gap-1 rounded-full border border-line px-2.5 text-[10px] font-semibold text-ink-muted">
                <EyeOff className="h-3 w-3" aria-hidden />
                {request.duplicateOf ? "Hidden as a duplicate" : `Hidden · ${notServiceLabel(request.classification) || "Not a service request"}`}
              </span>
            ) : (
              <span
                className={`inline-flex min-h-7 items-center rounded-full border px-2.5 text-[10px] font-semibold ${
                  isOpenRequest(request.status) ? "border-caution/30 bg-caution-bg text-caution" : "border-line text-ink-muted"
                }`}
              >
                {STATUS_LABELS[request.status] ?? request.status}
              </span>
            )}
            <span className="inline-flex min-h-7 items-center rounded-full border border-line px-2.5 text-[10px] font-semibold text-ink-muted">
              {request.origin === "website" ? "From your website" : (SOURCE_LABELS[request.source] ?? "Text")}
            </span>
          </div>
          <h2 className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm font-semibold">
            <span>
              {request.contactName || "Unnamed"} · {request.phone}
            </span>
            <SpanishBadge language={request.customerLanguage} />
          </h2>
          <p className="mt-1 line-clamp-3 text-sm leading-6 text-ink-muted">{request.description}</p>
          {request.address ? <p className="mt-1 text-xs text-ink-muted">{request.address}</p> : null}
        </div>
        <span className="shrink-0 text-[11px] text-ink-faint">{request.receivedLabel}</span>
      </div>

      {hidden ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3">
          <p className="text-xs text-ink-faint">Hidden {request.archivedLabel}. Not deleted; nobody was told.</p>
          <form action={restoreRequest}>
            <input type="hidden" name="requestId" value={request.id} />
            <input type="hidden" name="back" value="history" />
            <button
              type="submit"
              className="tap-target inline-flex min-h-11 items-center gap-2 rounded-chip border border-line px-3.5 text-xs font-semibold"
            >
              <RotateCcw className="h-4 w-4" aria-hidden /> Bring it back
            </button>
          </form>
        </div>
      ) : isOpenRequest(request.status) ? (
        <Link href="/booking-requests" className="mt-3 inline-flex min-h-11 items-center text-xs font-semibold text-brand">
          Answer it in Booking requests
        </Link>
      ) : request.jobId ? (
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-positive">
          <Check className="h-3.5 w-3.5" aria-hidden /> Became a job
        </p>
      ) : null}
    </article>
  );
}

/**
 * Every booking request the business ever had: searchable, with no week
 * cut-off, hidden ones included and marked. The waiting list stays about now;
 * this is where "what happened with that call in March" gets answered.
 */
export default async function BookingHistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; state?: string; source?: string; from?: string; to?: string; before?: string; saved?: string; error?: string }>;
}) {
  const query = await searchParams;
  const filter = {
    q: (query.q ?? "").slice(0, 80),
    state: STATES.some((entry) => entry.value === query.state) ? query.state ?? "" : "",
    source: SOURCES.some((entry) => entry.value === query.source) ? query.source ?? "" : "",
    from: query.from ?? "",
    to: query.to ?? "",
    before: query.before ?? "",
  };
  const history = await getBookingHistory(filter);
  if (history.requiresLogin) redirect("/login?next=/booking-requests/history");

  const filtered = Boolean(filter.q || filter.state || filter.source || filter.from || filter.to);
  const older = new URLSearchParams(
    Object.entries({ ...filter, before: history.next }).filter(([, value]) => value) as [string, string][],
  ).toString();

  return (
    <FieldPageShell
      title="Booking history"
      eyebrow="Requests for work"
      description="Every request, however old, including the ones you've hidden. Hidden isn't deleted."
      backHref="/booking-requests"
    >
      {query.saved ? <Banner tone="positive" className="mb-4">{query.saved}</Banner> : null}
      {query.error ? <Banner tone="critical" className="mb-4">{query.error}</Banner> : null}

      <form action="/booking-requests/history" className="mb-4 space-y-3 rounded-panel border border-line bg-surface p-4">
        <label className="block">
          <span className="text-xs font-semibold text-ink-muted">Name, phone, email, address or what they asked</span>
          <span className="mt-1 flex items-center gap-2 rounded-control border border-line bg-raised px-3 focus-within:border-brand/70">
            <Search className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
            <input
              name="q"
              defaultValue={filter.q}
              placeholder="e.g. Garcia, 0142, breaker"
              className="min-h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </span>
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectField name="state" label="Showing" defaultValue={filter.state} choices={STATES} placeholder="Everything" />
          <SelectField name="source" label="How they asked" defaultValue={filter.source} choices={SOURCES} placeholder="Any way" />
          <div>
            <span className="text-xs font-semibold text-ink-muted">From</span>
            <div className="mt-1">
              <DateField name="from" label="From" defaultValue={filter.from} timeZone={history.timezone} placeholder="Any day" />
            </div>
          </div>
          <div>
            <span className="text-xs font-semibold text-ink-muted">To</span>
            <div className="mt-1">
              <DateField name="to" label="To" defaultValue={filter.to} timeZone={history.timezone} placeholder="Any day" />
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className="tap-target rounded-control bg-brand px-5 text-sm font-bold text-on-brand">
            Search
          </button>
          {filtered ? (
            <Link href="/booking-requests/history" className="tap-target inline-flex items-center rounded-control border border-line px-4 text-sm font-semibold">
              Clear
            </Link>
          ) : null}
        </div>
      </form>

      {history.requests.length === 0 ? (
        <div className="rounded-panel border border-dashed border-line p-8 text-center text-sm text-ink-muted">
          {filtered || filter.before ? "Nothing matches." : "No booking requests yet."}
        </div>
      ) : (
        <div className="space-y-3">
          {history.requests.map((request) => (
            <HistoryCard key={request.id} request={request} />
          ))}
        </div>
      )}

      {history.next ? (
        <div className="mt-4 text-center">
          <Link
            href={`/booking-requests/history?${older}`}
            className="tap-target inline-flex items-center rounded-control border border-line px-5 text-sm font-semibold"
          >
            Older
          </Link>
        </div>
      ) : null}
    </FieldPageShell>
  );
}
