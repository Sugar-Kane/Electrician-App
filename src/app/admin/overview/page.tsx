import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";

import { AdminTime } from "@/components/admin-time";
import { Card, Pill, type Tone } from "@/components/admin-ui";
import {
  getMessagingEvidence,
  getPlatformFacts,
  listOrganizations,
  listOverdueVisits,
  listOverviewIssues,
  type OrganizationSummary,
  requirePlatformAdmin,
} from "@/lib/admin-console";
import { diagnose } from "@/lib/admin-health";
import { followUps, isPastVisit } from "@/lib/follow-ups";
import { kindOfWork } from "@/lib/new-job-input";
import { openCaseHref } from "@/lib/support-cases";

export const metadata: Metadata = {
  title: "Overview | Volteira support",
  robots: { index: false, follow: false },
};

type Group = "action" | "watch" | "unknown";

type Issue = {
  key: string;
  group: Group;
  title: string;
  detail: string;
  business: OrganizationSummary;
  firstAt: string;
  lastAt: string;
  occurrences: number;
  href: string;
  caseHref: string;
};

const GROUPS: { value: Group; title: string; empty: string; tone: Tone }[] = [
  { value: "action", title: "Needs action", empty: "Nothing is failing right now.", tone: "problem" },
  { value: "watch", title: "Watch", empty: "Nothing to watch.", tone: "waiting" },
  {
    value: "unknown",
    title: "Unknown",
    empty: "Every business has evidence one way or the other.",
    tone: "neutral",
  },
];

/** What a database-found issue is, in words, and where it opens. */
function describe(kind: string, occurrences: number): { title: string; detail: string; category: string } {
  switch (kind) {
    case "text_failing":
      return {
        title: "Texts failing now",
        detail: `${occurrences} failed ${occurrences === 1 ? "text" : "texts"} in the last week, with nothing delivered in the same conversation since.`,
        category: "texting",
      };
    case "alert_failing":
      return {
        title: "Booking alerts aren't reaching the owner",
        detail: `${occurrences} ${occurrences === 1 ? "booking" : "bookings"} in the last week where every owner alert failed.`,
        category: "booking",
      };
    case "assistant_problem":
      return {
        title: "Phone assistant problems",
        detail: `${occurrences} tool ${occurrences === 1 ? "call" : "calls"} in the last week failed outright, or said something was saved that wasn't.`,
        category: "assistant",
      };
    case "paid_unbooked":
      return {
        title: "Paid, but not booked",
        detail: "A deposit was paid for a booking that is neither confirmed, scheduled nor a job.",
        category: "payment",
      };
    default:
      return { title: kind.replace(/_/g, " "), detail: "", category: "other" };
  }
}

/**
 * What is going wrong across every business, worst first.
 *
 * Each issue says when it started, when it last happened, which business, and
 * opens the exact record, with a case one click away. Nothing that can't be
 * seen is called healthy: a business with no evidence either way is listed
 * under Unknown.
 */
export default async function AdminOverviewPage() {
  await requirePlatformAdmin();
  const [organizations, evidence, found, overdue, facts] = await Promise.all([
    listOrganizations(),
    getMessagingEvidence(null),
    listOverviewIssues(),
    listOverdueVisits(),
    getPlatformFacts(),
  ]);
  const live = organizations.filter((organization) => !organization.archived);
  const byId = new Map(live.map((organization) => [organization.id, organization]));
  const issues: Issue[] = [];

  for (const row of found) {
    const business = byId.get(row.organizationId);
    if (!business) continue;
    const base = `/admin/organizations/${business.id}`;
    const words = describe(row.kind, row.occurrences);
    const href =
      row.targetType === "message"
        ? `${base}/messages/${row.targetId}`
        : row.targetType === "booking"
          ? `${base}?tab=bookings#booking-${row.targetId}`
          : row.targetType === "assistant"
            ? `${base}?tab=assistant`
            : base;
    issues.push({
      key: `${row.kind}:${business.id}:${row.targetId}`,
      group: "action",
      title: words.title,
      detail: words.detail,
      business,
      firstAt: row.firstAt,
      lastAt: row.lastAt,
      occurrences: row.occurrences,
      href,
      caseHref: openCaseHref({
        organizationId: business.id,
        type: row.targetType,
        id: row.targetId,
        label: `${words.title} (most recent)`,
        category: words.category,
      }),
    });
  }

  // Past visits, by Today's rules, in each business's own time zone.
  const now = new Date();
  for (const business of live) {
    const jobs = overdue.filter((job) => job.organizationId === business.id);
    if (jobs.length === 0) continue;
    const visits = followUps({
      jobs: jobs.map((job) => ({
        id: job.number,
        customer: job.customerName,
        stage: job.status,
        startsAt: job.scheduledStart || undefined,
        endsAt: job.scheduledEnd || undefined,
        kindOfWork: kindOfWork(job.category),
      })),
      unbilled: {},
      now,
      timeZone: business.timeZone,
    }).filter(isPastVisit);
    if (visits.length === 0) continue;
    const times = visits.map((visit) => visit.at).filter(Boolean).sort();
    issues.push({
      key: `past:${business.id}`,
      group: "watch",
      title: "Past visits with no outcome",
      detail: `${visits.length} ${visits.length === 1 ? "visit" : "visits"} whose time has passed without a result, the same list as their Today.`,
      business,
      firstAt: times[0] ?? "",
      lastAt: times[times.length - 1] ?? "",
      occurrences: visits.length,
      href: `/admin/organizations/${business.id}#past-visits`,
      caseHref: openCaseHref({ organizationId: business.id, category: "schedule", label: "Past visits with no outcome" }),
    });
  }

  // Setup, as the Businesses list judges it.
  for (const business of live) {
    for (const finding of diagnose({ ...business, delivery: evidence.get(business.id) })) {
      const group: Group | null =
        finding.severity === "blocking" ? "action" : finding.severity === "degraded" ? "watch" : finding.title === "Delivery unknown" ? "unknown" : null;
      if (!group) continue;
      // Already listed above from the records themselves, with times.
      if (finding.title === "Texts are failing" && issues.some((issue) => issue.business.id === business.id && issue.title === "Texts failing now")) continue;
      issues.push({
        key: `setup:${business.id}:${finding.title}`,
        group,
        title: finding.title,
        detail: finding.detail,
        business,
        firstAt: "",
        lastAt: "",
        occurrences: 0,
        href: `/admin/organizations/${business.id}`,
        caseHref: openCaseHref({ organizationId: business.id, type: "business", id: business.id, label: finding.title, category: "other" }),
      });
    }
  }

  const sorted = issues.sort((a, b) => (b.lastAt || "").localeCompare(a.lastAt || ""));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Link href="/admin/cases" className="rounded-panel border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Open cases</p>
          <p className="mt-1 text-2xl font-semibold">{facts.openCases}</p>
          <p className={`mt-1 text-xs ${facts.overdueCases ? "text-critical" : "text-ink-faint"}`}>
            {facts.overdueCases ? `${facts.overdueCases} with an update overdue` : "No update overdue"}
          </p>
        </Link>
        <div className="rounded-panel border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Needs action</p>
          <p className="mt-1 text-2xl font-semibold">{sorted.filter((issue) => issue.group === "action").length}</p>
          <p className="mt-1 text-xs text-ink-faint">across {live.length} {live.length === 1 ? "business" : "businesses"}</p>
        </div>
        <div className="rounded-panel border border-line bg-surface p-4">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-ink-faint">Platform billing</p>
          <p className="mt-1 text-sm font-semibold">{facts.subscriptions === 0 ? "Not set up" : `${facts.subscriptions} subscriptions`}</p>
          <p className="mt-1 text-xs text-ink-faint">
            {facts.subscriptions === 0 ? "No business has a Volteira subscription recorded, so there is nothing to chart yet." : "Recorded in organization_subscriptions."}
          </p>
        </div>
      </div>

      {GROUPS.map((group) => {
        const shown = sorted.filter((issue) => issue.group === group.value);
        return (
          <Card key={group.value} title={group.title} aside={shown.length ? String(shown.length) : undefined}>
            {shown.length === 0 ? (
              <p className="flex items-center gap-2 text-sm text-ink-muted">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-positive" aria-hidden />
                {group.empty}
              </p>
            ) : (
              <ul className="space-y-2">
                {shown.map((issue) => (
                  <li key={issue.key} className="rounded-control border border-line p-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-semibold">
                        {issue.title} ·{" "}
                        <Link href={`/admin/organizations/${issue.business.id}`} className="text-brand">
                          {issue.business.name}
                        </Link>
                      </p>
                      <Pill tone={group.tone}>{group.title}</Pill>
                    </div>
                    {issue.detail ? <p className="mt-1 text-sm text-ink-muted">{issue.detail}</p> : null}
                    {issue.firstAt ? (
                      <p className="mt-1 text-xs text-ink-faint">
                        Since <AdminTime iso={issue.firstAt} timeZone={issue.business.timeZone} />
                        {issue.lastAt && issue.lastAt !== issue.firstAt ? (
                          <>
                            {" · last "}
                            <AdminTime iso={issue.lastAt} timeZone={issue.business.timeZone} />
                          </>
                        ) : null}
                      </p>
                    ) : null}
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
                      <Link href={issue.href} className="inline-flex min-h-11 items-center font-semibold text-brand">
                        Open the record
                      </Link>
                      <Link href={issue.caseHref} className="inline-flex min-h-11 items-center font-semibold text-ink-muted underline underline-offset-2">
                        Open a case
                      </Link>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        );
      })}
    </div>
  );
}
