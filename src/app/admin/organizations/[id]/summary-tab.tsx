import { CheckCircle2, TriangleAlert } from "lucide-react";

import { beginImpersonation } from "@/app/admin/impersonate/actions";
import { AdminTime } from "@/components/admin-time";
import { Card, Row } from "@/components/admin-ui";
import {
  getMessagingEvidence,
  listOrganizationMembers,
  listRecentBookings,
  type OrganizationDetail,
} from "@/lib/admin-console";
import { diagnose, failingNow, type Finding } from "@/lib/admin-health";
import { failureReason } from "@/lib/message-errors";

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
  const [members, bookings, evidence] = await Promise.all([
    listOrganizationMembers(id),
    listRecentBookings(id, 1),
    getMessagingEvidence(id),
  ]);
  const delivery = evidence.get(id);

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
