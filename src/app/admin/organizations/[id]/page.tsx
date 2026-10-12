import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AdminTime } from "@/components/admin-time";
import { RevealBar } from "@/components/admin-ui";
import { RevealCurrent } from "@/components/ui/reveal-current";
import { getOrganizationDetail, recordOrganizationTab, revealIsValid } from "@/lib/admin-console";
import { zoneAbbreviation } from "@/lib/admin-time";

import { ActivityTab } from "./activity-tab";
import { AssistantTab } from "./assistant-tab";
import { BookingsTab } from "./bookings-tab";
import { JobsTab } from "./jobs-tab";
import { MessagesTab } from "./messages-tab";
import { MoneyTab } from "./money-tab";
import { PeopleTab } from "./people-tab";
import { SummaryTab } from "./summary-tab";

export const metadata: Metadata = {
  title: "Business | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABS = [
  { value: "summary", label: "Summary" },
  { value: "people", label: "People" },
  { value: "jobs", label: "Jobs" },
  { value: "messages", label: "Texts" },
  { value: "bookings", label: "Bookings" },
  { value: "money", label: "Money" },
  { value: "assistant", label: "Assistant" },
  { value: "activity", label: "Activity" },
] as const;
type Tab = (typeof TABS)[number]["value"];

/** Tabs whose records include customers' phone numbers, emails or texts. */
const PRIVATE: ReadonlySet<Tab> = new Set(["messages", "bookings", "assistant", "activity"]);

/**
 * One business, read-only, in enough detail to answer a phone call about it.
 *
 * Opening each tab records an audit row: the reads reach a specific
 * electrician's configuration and their customers, which should not happen
 * invisibly — including when it is me doing it. Customers' contact details and
 * texts stay hidden until a reason is given.
 */
export default async function AdminOrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; reveal?: string; customer?: string; elevate?: string }>;
}) {
  const [{ id }, query] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const organization = await getOrganizationDetail(id);
  if (!organization) notFound();

  const tab: Tab = TABS.some((entry) => entry.value === query.tab) ? (query.tab as Tab) : "summary";
  const customerId = tab === "jobs" && UUID.test(query.customer ?? "") ? query.customer! : "";
  const label = TABS.find((entry) => entry.value === tab)!.label;
  const revealId = query.reveal ?? "";
  const [, revealed] = await Promise.all([
    recordOrganizationTab(id, customerId ? `${label} for one customer` : label),
    PRIVATE.has(tab) && UUID.test(revealId) ? revealIsValid(revealId, id) : Promise.resolve(false),
  ]);

  const base = `/admin/organizations/${id}`;
  const here = `${base}?tab=${tab}${customerId ? `&customer=${customerId}` : ""}`;
  const zone = organization.timeZone;

  return (
    <div className="space-y-4">
      <header className="sticky top-0 z-20 -mx-3 border-b border-line bg-canvas/95 px-3 pb-2 pt-3 backdrop-blur sm:-mx-5 sm:px-5 lg:-mx-8 lg:px-8">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h1 className="min-w-0 truncate text-xl font-semibold tracking-tight sm:text-2xl">{organization.name}</h1>
          <span className="rounded-full border border-line px-2.5 py-0.5 text-xs font-semibold text-ink-muted">
            Read-only
          </span>
        </div>
        <p className="mt-0.5 text-xs text-ink-faint">
          {[organization.city, organization.state].filter(Boolean).join(", ") || "No address"} ·{" "}
          {organization.phone || "no phone"} · times below are {zone} ({zoneAbbreviation(zone)}) · since{" "}
          <AdminTime iso={organization.createdAt} timeZone={zone} dateOnly />
        </p>
        <nav
          id="business-tabs"
          aria-label="Parts of this business"
          className="-mx-3 mt-2 flex gap-1.5 overflow-x-auto px-3 pb-1 sm:mx-0 sm:flex-wrap sm:px-0"
        >
          {TABS.map((entry) => (
            <Link
              key={entry.value}
              href={entry.value === "summary" ? base : `${base}?tab=${entry.value}`}
              aria-current={entry.value === tab ? "page" : undefined}
              className={`tap-target inline-flex shrink-0 items-center whitespace-nowrap rounded-chip px-3 text-xs font-semibold ${
                entry.value === tab ? "bg-brand text-on-brand" : "border border-line text-ink-muted hover:text-ink"
              }`}
            >
              {entry.label}
            </Link>
          ))}
        </nav>
        <RevealCurrent targetId="business-tabs" />
      </header>

      {PRIVATE.has(tab) ? (
        <RevealBar organizationId={id} scope={label} returnTo={here} revealed={revealed} hideHref={here} />
      ) : null}
      {query.reveal === "reason" ? (
        <p className="text-sm text-critical">Say why you need to see them. The reason goes on the activity record.</p>
      ) : null}

      {tab === "summary" ? <SummaryTab organization={organization} elevate={query.elevate ?? ""} /> : null}
      {tab === "people" ? <PeopleTab organization={organization} /> : null}
      {tab === "jobs" ? <JobsTab organization={organization} customerId={customerId} /> : null}
      {tab === "messages" ? <MessagesTab organization={organization} revealed={revealed} /> : null}
      {tab === "bookings" ? <BookingsTab organization={organization} revealed={revealed} /> : null}
      {tab === "money" ? <MoneyTab organization={organization} /> : null}
      {tab === "assistant" ? <AssistantTab organization={organization} revealed={revealed} /> : null}
      {tab === "activity" ? <ActivityTab organization={organization} revealed={revealed} /> : null}
    </div>
  );
}
