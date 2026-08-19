import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ChevronRight,
  Mail,
  MapPin,
  MessagesSquare,
  Phone,
  TriangleAlert,
} from "lucide-react";

import { FieldPageShell } from "@/components/field-page-shell";
import { StatusBadge } from "@/components/ui/status-badge";
import { getCustomerProfile } from "@/lib/customer-profile";

/**
 * One customer, and everything of theirs.
 *
 * Search had nowhere to send anybody before this: results were jobs, so finding
 * "John Smith" meant finding one of John's jobs and reading the customer off
 * it. A person is not a job, and the whole point of matching an existing
 * customer rather than creating a second one is that there is a single place
 * their history lives.
 *
 * Deliberately a beginning rather than the full profile screen the intake
 * specification describes: who they are, where the work is, what is open, and
 * the conversation. The concern, the AI summary, the photos, the diagnostic
 * status and the electrician's actions belong to the handoff screen, which is
 * its own piece of work rather than a half-built version of it here.
 */
export const dynamic = "force-dynamic";

export default async function CustomerPage({
  params,
}: {
  params: Promise<{ customerId: string }>;
}) {
  const { customerId } = await params;
  const profile = await getCustomerProfile(customerId);
  if (!profile) notFound();

  return (
    <FieldPageShell
      title={profile.name}
      eyebrow="Customer"
      description={profile.address || "No service address on file yet."}
      backHref="/search"
    >
      <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
        <div className="flex flex-wrap gap-2">
          {profile.phone ? (
            <a
              href={`tel:${profile.phone.replace(/[^\d+]/g, "")}`}
              className="tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
            >
              <Phone className="h-4 w-4" aria-hidden />
              Call
            </a>
          ) : null}
          {profile.phone ? (
            <Link
              href={
                profile.conversationId ? `/messages/${profile.conversationId}` : "/messages/new"
              }
              className="tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
            >
              <MessagesSquare className="h-4 w-4" aria-hidden />
              Text
            </Link>
          ) : null}
          {profile.email ? (
            <a
              href={`mailto:${profile.email}`}
              className="tap-target inline-flex min-h-12 flex-1 items-center justify-center gap-2 rounded-control border border-line px-4 text-sm font-semibold"
            >
              <Mail className="h-4 w-4" aria-hidden />
              Email
            </a>
          ) : null}
        </div>

        <dl className="mt-4 space-y-2 text-sm">
          {profile.phone ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Phone</dt>
              <dd className="font-semibold">{profile.phone}</dd>
            </div>
          ) : null}
          {profile.email ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Email</dt>
              <dd className="min-w-0 truncate font-semibold">{profile.email}</dd>
            </div>
          ) : null}
          {profile.preferredContact ? (
            <div className="flex items-center justify-between gap-3">
              <dt className="text-ink-muted">Prefers</dt>
              <dd className="font-semibold">{profile.preferredContact}</dd>
            </div>
          ) : null}
        </dl>
      </section>

      {profile.openRequests.length > 0 ? (
        <section className="mt-3 rounded-panel border border-caution/40 bg-caution-bg/40 p-4 sm:p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-caution">
            <TriangleAlert className="h-4 w-4" aria-hidden />
            Waiting on us
          </h2>
          <ul className="mt-2 space-y-2">
            {profile.openRequests.map((request) => (
              <li key={request.id}>
                <Link
                  href="/booking-requests"
                  className="tap-row flex min-h-[52px] items-center gap-2 rounded-control border border-line px-3 py-2 text-sm active:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">{request.summary}</span>
                    <span className="block truncate text-xs text-ink-muted">{request.status}</span>
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {profile.properties.length > 0 ? (
        <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">Where the work is</h2>
          <ul className="mt-2 space-y-2">
            {profile.properties.map((property) => (
              <li key={property.id} className="flex items-start gap-2 text-sm">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-ink-faint" aria-hidden />
                <span className="min-w-0">
                  <span className="block">{property.address}</span>
                  {property.accessNotes ? (
                    <span className="block text-xs text-ink-muted">{property.accessNotes}</span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
        <h2 className="text-sm font-semibold">Jobs</h2>
        {profile.jobs.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Nothing booked for them yet.</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {profile.jobs.map((job) => (
              <li key={job.id}>
                <Link
                  href={`/jobs/${job.number}`}
                  className="tap-row flex min-h-[52px] items-center gap-3 rounded-control border border-line px-3 py-2 active:bg-white/5"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">
                      #{job.number} · {job.when}
                    </span>
                    <span className="block truncate text-xs text-ink-muted">{job.summary}</span>
                  </span>
                  <StatusBadge status={job.status} />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </FieldPageShell>
  );
}
