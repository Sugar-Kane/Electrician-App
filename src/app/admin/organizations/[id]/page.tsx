import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, TriangleAlert } from "lucide-react";

import { AdminInviteForm } from "@/components/admin-invite-form";
import { beginImpersonation } from "@/app/admin/impersonate/actions";
import {
  getOrganizationDetail,
  listMcpCalls,
  listOrganizationMembers,
  listRecentBookings,
  recordOrganizationView,
} from "@/lib/admin-console";
import { diagnose, type Finding } from "@/lib/admin-health";

export const metadata: Metadata = {
  title: "Business | Volteira support",
  robots: { index: false, follow: false },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const FINDING_STYLE: Record<Finding["severity"], string> = {
  blocking: "border-rose-400/30 bg-rose-400/[0.07] text-rose-100",
  degraded: "border-amber-300/25 bg-amber-300/[0.06] text-amber-100",
  note: "border-white/10 bg-white/[0.03] text-slate-300",
};

function stamp(iso: string): string {
  if (!iso) return "—";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
      <h2 className="text-lg font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-white/5 py-2 last:border-0">
      <dt className="text-sm text-slate-400">{label}</dt>
      <dd className="text-sm font-medium">{value || "—"}</dd>
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
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const organization = await getOrganizationDetail(id);
  if (!organization) notFound();

  await recordOrganizationView(id);

  const [members, bookings, calls] = await Promise.all([
    listOrganizationMembers(id),
    listRecentBookings(id, 15),
    listMcpCalls(id, 25),
  ]);

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
  });

  return (
    <div className="space-y-4">
      <header className="rounded-3xl border border-white/10 bg-[#0b1b27] p-5 sm:p-6">
        <h1 className="text-2xl font-semibold tracking-tight">{organization.name}</h1>
        <p className="mt-1 text-sm text-slate-400">
          {[organization.address, organization.city, organization.state, organization.postalCode]
            .filter(Boolean)
            .join(", ") || "No address"}
        </p>
        <p className="mt-1 text-sm text-slate-500">
          {organization.phone} · {organization.timeZone} · since {stamp(organization.createdAt)}
        </p>
      </header>

      <Card title="What's wrong">
        {findings.length === 0 ? (
          <p className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 className="h-4 w-4 shrink-0" aria-hidden />
            Nothing. Everything this console checks is configured.
          </p>
        ) : (
          <ul className="space-y-2">
            {findings.map((finding) => (
              <li
                key={finding.title}
                className={`flex items-start gap-3 rounded-2xl border p-4 ${FINDING_STYLE[finding.severity]}`}
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

      <Card title="Work inside this business">
        <p className="text-sm leading-6 text-ink-muted">
          Opens the app as a member of {organization.name} with full access, for one hour.
          Anything you do is real: a cancelled job texts their customer, and an invoice is
          their invoice. It is recorded against your account, not the owner&rsquo;s.
        </p>
        <form action={beginImpersonation} className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input type="hidden" name="organizationId" value={id} />
          <input
            name="reason"
            maxLength={200}
            placeholder="Why, e.g. owner cannot see their schedule"
            className="min-h-12 flex-1 rounded-control border border-line bg-raised px-4 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-brand/70"
          />
          <button
            type="submit"
            className="tap-target shrink-0 rounded-control bg-brand px-5 text-sm font-bold text-on-brand"
          >
            Open as this business
          </button>
        </form>
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
          <Row label="A2P approved" value={organization.a2pRegisteredAt ? stamp(organization.a2pRegisteredAt) : "Not approved"} />
          <Row label="Legal pages" value={organization.legalPublished ? "Published" : "Not published"} />
          <Row label="Booking page" value={`/book/${organization.slug}`} />
        </dl>
      </Card>

      <Card title="People">
        {members.length === 0 ? (
          <p className="text-sm text-slate-400">Nobody has joined this business.</p>
        ) : (
          <ul className="space-y-2">
            {members.map((member) => (
              <li key={member.userId} className="rounded-2xl border border-white/10 p-4">
                <p className="text-sm font-semibold">{member.fullName || member.email}</p>
                <p className="mt-1 text-sm text-slate-400">
                  {member.email} · {member.role}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Joined {stamp(member.joinedAt)} · last signed in {stamp(member.lastSignInAt)}
                  {member.emailConfirmed ? "" : " · email not confirmed"}
                </p>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-5 border-t border-white/10 pt-5">
          <p className="mb-4 text-sm text-slate-400">
            Invite somebody into this business. Works even when nobody on the inside can sign
            in to do it themselves.
          </p>
          <AdminInviteForm organizationId={id} />
        </div>
      </Card>

      <Card title="Recent bookings">
        {bookings.length === 0 ? (
          <p className="text-sm text-slate-400">No bookings.</p>
        ) : (
          <ul className="space-y-3">
            {bookings.map((booking) => (
              <li key={booking.id} className="rounded-2xl border border-white/10 p-4">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {booking.contactName || "No name"} · {booking.status}
                  </p>
                  <p className="text-xs text-slate-500">{stamp(booking.createdAt)}</p>
                </div>
                <p className="mt-1 text-sm text-slate-400">
                  {booking.phone}
                  {booking.email ? ` · ${booking.email}` : ""}
                </p>
                <p className="mt-1 text-sm text-slate-300">{booking.description}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {booking.windowStart ? `Window ${stamp(booking.windowStart)}` : "No window"} ·{" "}
                  {booking.intakeAnswerCount} intake answers
                </p>

                {booking.notifications.length > 0 ? (
                  <ul className="mt-3 space-y-1">
                    {booking.notifications.map((attempt, index) => (
                      <li
                        key={`${booking.id}-${index}`}
                        className={`rounded-xl px-3 py-2 text-xs ${attempt.ok ? "bg-emerald-400/[0.08] text-emerald-200" : "bg-rose-400/[0.08] text-rose-200"}`}
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
                  <p className="mt-3 text-xs text-slate-500">
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
          <p className="text-sm text-slate-400">
            The voice agent has never reached this server for this business. If they say the
            phone does nothing, this is the confirmation — check that the agent is published
            with the right connector URL.
          </p>
        ) : (
          <ul className="space-y-2">
            {calls.map((call) => (
              <li
                key={call.id}
                className={`rounded-2xl border p-3 text-xs ${call.isError ? "border-rose-400/25 bg-rose-400/[0.06]" : "border-white/10"}`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="font-semibold">
                    {call.method}
                    {call.toolName ? ` · ${call.toolName}` : ""}
                  </span>
                  <span className="text-slate-500">
                    {stamp(call.createdAt)} · {call.httpStatus} · {call.durationMs}ms
                  </span>
                </div>
                {call.resultText ? (
                  <pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-black/30 p-3 text-slate-400">
                    {call.resultText}
                  </pre>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
