import Link from "next/link";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { beginImpersonation } from "@/app/admin/impersonate/actions";
import { AdminTime } from "@/components/admin-time";
import { Card, Row } from "@/components/admin-ui";
import {
  getMessagingEvidence,
  listOrganizationMembers,
  listOrgJobs,
  listRecentBookings,
  type OrganizationDetail,
} from "@/lib/admin-console";
import { diagnose, failingNow, type Finding } from "@/lib/admin-health";
import { followUps, isPastVisit } from "@/lib/follow-ups";
import { failureReason } from "@/lib/message-errors";
import { kindOfWork } from "@/lib/new-job-input";
import { openCaseHref } from "@/lib/support-cases";

const FINDING_STYLE: Record<Finding["severity"], string> = {
  blocking: "border-critical/30 bg-critical-bg text-critical",
  degraded: "border-caution/25 bg-caution-bg text-caution",
  note: "border-line bg-white/[0.03] text-ink-muted",
};

/** What's wrong, how the business is set up, and the elevated way in. */
export async function SummaryTab({
  organization,
  elevate,
  owner,
}: {
  organization: OrganizationDetail;
  elevate: string;
  /** Support admins look and check; only owners can make changes. */
  owner: boolean;
}) {
  const id = organization.id;
  const zone = organization.timeZone;
  const [members, bookings, evidence, jobs] = await Promise.all([
    listOrganizationMembers(id),
    listRecentBookings(id, 1),
    getMessagingEvidence(id),
    listOrgJobs(id),
  ]);
  const delivery = evidence.get(id);

  // Worked out exactly as the business's own Today does it, so support and the
  // electrician see the same list.
  const pastVisits = followUps({
    jobs: jobs.map((job) => ({
      id: job.number,
      customer: job.customerName,
      stage: job.status,
      startsAt: job.scheduledStart || undefined,
      endsAt: job.scheduledEnd || undefined,
      kindOfWork: kindOfWork(job.category),
    })),
    unbilled: {},
    now: new Date(),
    timeZone: zone,
  }).filter(isPastVisit);

  const findings = diagnose({
    memberCount: members.length,
    pendingInvitations: 0,
    bookingCount: bookings.length,
    lastBookingAt: bookings[0]?.createdAt ?? "",
    ownerEmail: organization.ownerEmail,
    ownerPhone: organization.ownerPhone,
    messagingServiceSid: organization.messagingServiceSid,
    a2pRegistered: Boolean(organization.a2pRegisteredAt),
    legalPublished: organization.legalPublished,
    archived: organization.archived,
    delivery,
  });

  return (
    <>
      <Card title="What's wrong">
        {findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-positive">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Nothing. Everything this console checks is configured.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li
                key={finding.title}
                className={`flex items-start gap-3 rounded-control border p-4 ${FINDING_STYLE[finding.severity]}`}
              >
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span>
                  <span className="block text-sm font-semibold">{finding.title}</span>
                  <span className="mt-1 block text-sm leading-6 opacity-90">{finding.detail}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Past visits with no outcome" id="past-visits" aside={pastVisits.length ? `${pastVisits.length}` : undefined}>
        {pastVisits.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-positive">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            None. Every visit whose time has passed has a result.
          </p>
        ) : (
          <>
            <p className="text-sm leading-6 text-ink-muted">
              The same list the business sees on Today. Nothing here is completed on its own: each choice opens the job as
              the business, for an hour, so the normal steps run — a reschedule texts the customer, a completion asks for
              the work done. Not sure what happened? Open a case and ask the business before changing anything.
            </p>
            <ul className="mt-3 space-y-2">
              {pastVisits.slice(0, 12).map((visit) => (
                <li key={visit.jobNumber} id={`visit-${visit.jobNumber}`} className="rounded-control border border-line p-3">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <Link href={`/admin/organizations/${id}/jobs/${visit.jobNumber}`} className="text-sm font-semibold text-brand">
                      Job #{visit.jobNumber} · {visit.customer || "No customer"}
                    </Link>
                    {visit.kindOfWork ? <span className="text-xs text-ink-faint">{visit.kindOfWork}</span> : null}
                  </div>
                  <p className="mt-1 text-sm text-ink-muted">
                    {visit.detail} ·{" "}
                    <Link
                      href={openCaseHref({
                        organizationId: id,
                        type: "job",
                        id: jobs.find((job) => job.number === visit.jobNumber)?.id,
                        label: `Job #${visit.jobNumber}: past visit, outcome unknown`,
                        category: "schedule",
                      })}
                      className="text-xs font-semibold text-ink-muted underline underline-offset-2"
                    >
                      Not sure? Open a case
                    </Link>
                  </p>
                  {owner ? (
                    <details className="mt-2 rounded-control border border-line">
                      <summary className="tap-target flex cursor-pointer list-none items-center px-3 text-xs font-semibold text-ink-muted">
                        Sort it out
                      </summary>
                      <form action={beginImpersonation} className="flex flex-col gap-2 px-3 pb-3 lg:flex-row">
                        <input type="hidden" name="organizationId" value={id} />
                        <input type="hidden" name="next" value={`/jobs/${visit.jobNumber}`} />
                        <label className="min-w-0 flex-1">
                          <span className="sr-only">Reason</span>
                          <input
                            name="reason"
                            required
                            minLength={3}
                            maxLength={140}
                            placeholder="Why, e.g. owner called: customer wasn't home"
                            className="min-h-11 w-full rounded-control border border-line bg-raised px-3 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70"
                          />
                        </label>
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" name="choice" value="reschedule" className="tap-target rounded-control border border-line px-3 text-xs font-semibold">
                            Didn&rsquo;t happen: reschedule
                          </button>
                          <button type="submit" name="choice" value="complete" className="tap-target rounded-control border border-line px-3 text-xs font-semibold">
                            Work happened: complete
                          </button>
                        </div>
                      </form>
                    </details>
                  ) : null}
                </li>
              ))}
            </ul>
            {pastVisits.length > 12 ? (
              <p className="mt-2 text-xs text-ink-faint">
                And {pastVisits.length - 12} more. <Link href={`/admin/organizations/${id}?tab=jobs`} className="font-semibold text-brand">All jobs</Link>
              </p>
            ) : null}
          </>
        )}
      </Card>

      <Card title="Setup">
        <dl>
          <Row label="Booking alert email" value={organization.ownerEmail} />
          <Row label="Booking alert phone" value={organization.ownerPhone} />
          <Row label="Diagnostic fee" value={`$${(organization.diagnosticFeeCents / 100).toFixed(2)}`} />
          <Row label="Visit length" value={`${organization.diagnosticMinutes} minutes`} />
          <Row label="Messaging service" value={organization.messagingServiceSid} />
          <Row label="Messaging number" value={organization.messagingPhone} />
          <Row label="A2P campaign" value={organization.a2pCampaignId} />
          <Row
            label="A2P approval (recorded by hand)"
            value={organization.a2pRegisteredAt ? <AdminTime iso={organization.a2pRegisteredAt} timeZone={zone} dateOnly /> : "Not recorded"}
          />
          <Row
            label="Last delivered text"
            value={delivery?.lastDeliveredAt ? <AdminTime iso={delivery.lastDeliveredAt} timeZone={zone} /> : "No delivery report yet"}
          />
          <Row
            label="Failed texts, last 7 days"
            value={
              delivery && delivery.failures7d.length > 0
                ? delivery.failures7d
                    .map((entry) => `${failureReason(entry.code).words}${entry.code ? ` (${entry.code})` : ""} ×${entry.count}`)
                    .join(" · ")
                : "None"
            }
          />
          <Row
            label="Last failed text"
            value={
              delivery?.lastFailedAt ? (
                <>
                  <AdminTime iso={delivery.lastFailedAt} timeZone={zone} /> · {failureReason(delivery.lastFailedCode).words}
                  {failingNow(delivery) ? "" : " · history, delivered since"}
                </>
              ) : (
                "None"
              )
            }
          />
          <Row label="Legal pages" value={organization.legalPublished ? "Published" : "Not published"} />
          <Row label="Booking page" value={`/book/${organization.slug}`} />
        </dl>
      </Card>

      {owner ? (
        <Card title="Make changes as this business">
          <div id="elevate" className="scroll-mt-28" />
          <p className="text-sm leading-6 text-ink-muted">
            Everything in this console is read-only. If you need to act for {organization.name}, this opens the app as
            one of its members with full access for one hour. Anything you do is real: a cancelled job texts their
            customer, and an invoice is their invoice. It is recorded against your account, with the reason you give.
          </p>
          {elevate === "reason" ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-critical">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              Say why you need to make changes. The reason goes on the activity record.
            </p>
          ) : elevate === "refused" ? (
            <p className="mt-3 flex items-start gap-2 text-sm text-critical">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              That didn&rsquo;t start. The business may be archived, or your access may have changed.
            </p>
          ) : null}
          <form action={beginImpersonation} className="mt-4 flex flex-col gap-3 sm:flex-row">
            <input type="hidden" name="organizationId" value={id} />
            <label className="min-w-0 flex-1">
              <span className="sr-only">Reason</span>
              <input
                name="reason"
                required
                minLength={3}
                maxLength={200}
                placeholder="Why, e.g. owner can't see their schedule"
                className="min-h-12 w-full rounded-control border border-line bg-raised px-4 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70"
              />
            </label>
            <button
              type="submit"
              className="tap-target shrink-0 rounded-control border border-brand/50 px-5 text-sm font-bold text-brand"
            >
              Make changes as {organization.name}
            </button>
          </form>
        </Card>
      ) : null}
    </>
  );
}
