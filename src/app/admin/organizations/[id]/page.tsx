import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { AdminInviteForm } from "@/components/admin-invite-form";
import { AdminTime } from "@/components/admin-time";
import { beginImpersonation } from "@/app/admin/impersonate/actions";
import {
  getMessagingEvidence,
  getOrganizationDetail,
  listMcpCalls,
  listOrganizationMembers,
  listRecentBookings,
  recordOrganizationView,
} from "@/lib/admin-console";
import { diagnose, failingNow, type Finding } from "@/lib/admin-health";
import { zoneAbbreviation } from "@/lib/admin-time";
import { failureReason } from "@/lib/message-errors";

export const metadata: Metadata = {
  title: "Business | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FINDING_STYLE: Record<Finding["severity"], string> = {
  blocking: "border-critical/30 bg-critical-bg text-critical",
  degraded: "border-caution/25 bg-caution-bg text-caution",
  note: "border-line bg-white/[0.03] text-ink-muted",
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-panel border border-line bg-surface p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 py-2 last:border-0">
      <dt className="text-sm text-ink-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{value || "—"}</dd>
    </div>
  );
}

/**
 * One business, in enough detail to answer a phone call about it.
 *
 * Opening this page records an audit row. The reads below reach a specific
 * electrician's configuration and their customers' contact details, which is
 * not something that should happen invisibly — including when it is me doing
 * it.
 */
export default async function AdminOrganizationPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ elevate?: string }>;
}) {
  const [{ id }, { elevate }] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();

  const organization = await getOrganizationDetail(id);
  if (!organization) notFound();

  await recordOrganizationView(id);

  const [members, bookings, calls, evidence] = await Promise.all([
    listOrganizationMembers(id),
    listRecentBookings(id, 15),
    listMcpCalls(id, 25),
    getMessagingEvidence(id),
  ]);
  const zone = organization.timeZone;
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
    <div className="space-y-4">
      <header className="rounded-panel border border-line bg-surface p-5 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="mt-1 text-sm text-ink-muted">
          {[organization.address, organization.city, organization.state, organization.postalCode]
            .filter(Boolean)
            .join(", ") || "No address"}
        </p>
        <p className="mt-1 text-sm text-ink-faint">
          {organization.phone} · times below are {zone} ({zoneAbbreviation(zone)}) · since{" "}
          <AdminTime iso={organization.createdAt} timeZone={zone} dateOnly />
        </p>
      </header>

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

      <Card title="People">
        {members.length === 0 ? (
          <p className="text-sm text-ink-muted">Nobody has joined this business.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.userId} className="rounded-control border border-line p-4">
                <p className="text-sm font-semibold">{member.fullName || member.email}</p>
                <p className="mt-1 text-sm text-ink-muted">
                  {member.email} · {member.role}
                </p>
                <p className="mt-1 text-xs text-ink-faint">
                  Joined <AdminTime iso={member.joinedAt} timeZone={zone} dateOnly /> · last signed in{" "}
                  <AdminTime iso={member.lastSignInAt} timeZone={zone} empty="never" />
                  {member.emailConfirmed ? "" : " · email not confirmed"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-line pt-5">
          <p className="mb-4 text-sm text-ink-muted">
            Invite somebody into this business. Works even when nobody on the inside can sign
            in to do it themselves.
          </p>
          <AdminInviteForm organizationId={id} />
        </div>
      </Card>

      <Card title="Recent bookings">
        {bookings.length === 0 ? (
          <p className="text-sm text-ink-muted">No bookings.</p>
        ) : (
          <ul className="space-y-3">
            {bookings.map((booking) => (
              <li key={booking.id} className="rounded-control border border-line p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {booking.contactName || "No name"} · {booking.status}
                  </p>
                  <p className="text-xs text-ink-faint">
                    <AdminTime iso={booking.createdAt} timeZone={zone} />
                  </p>
                </div>
                <p className="mt-1 text-sm text-ink-muted">
                  {booking.phone}
                  {booking.email ? ` · ${booking.email}` : ""}
                </p>
                <p className="mt-1 text-sm text-ink-muted">{booking.description}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  {booking.windowStart ? (
                    <>
                      Window <AdminTime iso={booking.windowStart} timeZone={zone} />
                    </>
                  ) : (
                    "No window"
                  )}{" "}
                  ·{" "}
                  {booking.intakeAnswerCount} intake answers
                </p>

                {booking.notifications.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {booking.notifications.map((attempt, index) => (
                      <li
                        key={`${booking.id}-${index}`}
                        className={`rounded-chip px-3 py-2 text-xs ${attempt.ok ? "bg-positive-bg text-positive" : "bg-critical-bg text-critical"}`}
                      >
                        <span className="font-semibold">
                          {attempt.audience} {attempt.channel}
                        </span>
                        {attempt.to ? ` → ${attempt.to}` : ""} · {attempt.ok ? "sent" : "failed"}
                        {attempt.detail ? ` — ${attempt.detail}` : ""}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="mt-3 text-xs text-ink-faint">
                    No notification record — this booking predates the tracking, or nothing was
                    attempted.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Phone assistant calls">
        {calls.length === 0 ? (
          <p className="text-sm text-ink-muted">
            The voice agent has never reached this server for this business. If they say the
            phone does nothing, this is the confirmation — check that the agent is published
            with the right connector URL.
          </p>
        ) : (
          <ul className="space-y-2">
            {calls.map((call) => (
              <li
                key={call.id}
                className={`rounded-control border p-3 text-xs ${call.isError ? "border-critical/25 bg-critical-bg" : "border-line"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {call.method}
                    {call.toolName ? ` · ${call.toolName}` : ""}
                  </span>
                  <span className="text-ink-faint">
                    <AdminTime iso={call.createdAt} timeZone={zone} /> · {call.httpStatus} · {call.durationMs}ms
                  </span>
                </div>
                {call.resultText ? (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-chip bg-black/30 p-3 text-ink-muted">
                    {call.resultText}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title="Make changes as this business">
        <div id="elevate" className="scroll-mt-4" />
        <p className="text-sm leading-6 text-ink-muted">
          Everything above is read-only. If you need to act for {organization.name}, this opens the app as one of its
          members with full access for one hour. Anything you do is real: a cancelled job texts their customer, and an
          invoice is their invoice. It is recorded against your account, with the reason you give.
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
    </div>
  );
}
