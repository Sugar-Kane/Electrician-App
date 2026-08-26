import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, ChevronDown, ChevronRight, MapPin, ShieldAlert } from "lucide-react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { FieldPageShell } from "@/components/field-page-shell";
import { jobNeedsMaterialStop, pilotJobs } from "@/lib/pilot-data";
import { JobContract } from "@/components/job-contract";
import { JobCallRecord } from "@/components/job-call-record";
import { JobLinesPanel } from "@/components/job-lines-panel";
import { JobMenu } from "@/components/job-menu";
import { JobNotes } from "@/components/job-notes";
import { JobPhotos } from "@/components/job-photos";
import { JobWorkflow } from "@/components/job-workflow";
import { AssignTechnician } from "@/components/assign-technician";
import { JobSource } from "@/components/ui/job-source";
import { StatusBadge } from "@/components/ui/status-badge";
import { todayInZone } from "@/lib/calendar";
import { getJob, getJobContracts, getJobControls, getJobHistory } from "@/lib/job-data";
import { getJobIntake } from "@/lib/job-intake";
import { getJobConversation, getMessagingContext } from "@/lib/messaging";
import { getJobLines, getStockOptions } from "@/lib/job-line-data";
import { getJobPhotos } from "@/lib/job-photo-data";
import { getJobWorkflow } from "@/lib/job-workflow-data";
import { showsWorkspace } from "@/lib/job-workflow";

/**
 * One job, in the order somebody standing outside a house needs it.
 *
 * The page this replaces answered every question a job could ever raise, all at
 * once, in eight bordered cards of equal weight: where it is, what to bill, what
 * the contract says, when it is scheduled for, and whether to call it off. Half
 * of it was administration — an arrival-window editor with two datetime pickers
 * and a status dropdown, then a permanent card offering to cancel — and it was
 * all above the notes field somebody actually opened the page to fill in.
 *
 * Now it answers five questions in the order they are asked: where am I going,
 * what does the customer need, what do I do next, what do I write down, and how
 * do I finish. Everything else is one tap away and nothing else is on screen.
 */

/*
 * A ceiling, not a reservation, and it is here for one thing.
 *
 * Completing a job schedules the work-journal write with `after()`, which runs
 * once the response has gone but is still billed to this segment's budget. On
 * the platform default that budget is measured in seconds and a model call is
 * measured in tens of them, so the function would be killed part-way through
 * every write and no post would ever appear — silently, because the tap that
 * started it already succeeded.
 *
 * 120 covers two attempts at 45 seconds plus the reads around them. Nothing
 * else on this page runs long, and a ceiling costs nothing when it is not
 * reached. Every other route here that talks to a model sets one for the same
 * reason: the assistant 60, the receipt scanner 90.
 */
export const maxDuration = 120;

export function generateStaticParams() {
  return pilotJobs.map((job) => ({ jobId: job.id }));
}

export default async function JobDetailPage({ params }: { params: Promise<{ jobId: string }> }) {
  const { jobId } = await params;
  const { job } = await getJob(jobId);
  if (!job) notFound();

  // Null for the signed-out demo view, where there is nothing real to advance.
  const [controls, workflow, contracts, { lines, totals }, stock, photos, messaging, history] =
    await Promise.all([
      getJobControls(jobId),
      getJobWorkflow(jobId),
      getJobContracts(jobId),
      getJobLines(jobId),
      getStockOptions(),
      getJobPhotos(jobId),
      getMessagingContext(),
      getJobHistory(jobId),
    ]);

  const [conversations, callRecord] = messaging
    ? await Promise.all([getJobConversation(messaging, jobId), getJobIntake(messaging, jobId)])
    : [[], null];

  const fullAddress = `${job.address}, ${job.city}`;
  const hasAddress = fullAddress.trim() !== ",";
  const needsStop = jobNeedsMaterialStop(job);
  // Destination only, so the maps app starts from wherever the phone is. The
  // route-builder URL names the shop as the origin, which is right for planning
  // a day and wrong for a technician already standing somewhere else.
  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(fullAddress)}`;

  const canceled = controls?.canceled ?? job.status === "Canceled";
  const state = workflow?.state ?? "scheduled";
  const workspaceOpen = showsWorkspace(state) && !canceled;

  /**
   * Who, what and where — the first thing read and the least of it.
   *
   * Rendered into the workflow card rather than beside it, so the facts and the
   * button that acts on them are one object.
   */
  const identity = (
    <div>
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm capitalize text-ink-muted">
        {job.workType.replace(/_/g, " ")}
        <JobSource channel={job.channel} className="normal-case" />
      </p>
      <p className="mt-0.5 text-sm text-ink-muted">
        {job.dateLabel} · {job.time}–{job.endTime}
      </p>
      {hasAddress ? (
        <p className="mt-2 flex items-start gap-2 text-base font-medium leading-6">
          <MapPin className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <span>
            {job.address}
            {job.city ? <span className="block text-ink-muted">{job.city}</span> : null}
          </span>
        </p>
      ) : null}
    </div>
  );

  return (
    <FieldPageShell
      compact
      title={job.contactName || job.customer}
      eyebrow={`Job #${job.id}`}
      backHref="/schedule"
      action={controls ? <JobMenu jobNumber={controls.jobNumber} hasContract={contracts.length > 0} /> : null}
    >
      {canceled ? (
        <section className="mb-3 rounded-panel border border-critical/30 bg-critical-bg p-4 sm:p-5">
          <div className="flex items-start gap-3">
            <Ban className="mt-0.5 h-5 w-5 shrink-0 text-critical" aria-hidden />
            <div>
              <h2 className="font-semibold">This job is canceled</h2>
              <p className="mt-1 text-sm leading-6 text-ink-muted">
                {controls?.cancellationReason || "No reason was recorded."}
              </p>
            </div>
          </div>
        </section>
      ) : null}

      {workflow && !canceled ? (
        <JobWorkflow
          jobNumber={workflow.jobNumber}
          state={workflow.state}
          destination={workflow.destination}
          radiusMeters={workflow.radiusMeters}
          tripStartedLabel={workflow.tripStartedLabel}
          arrivedLabel={workflow.arrivedLabel}
          workStartedLabel={workflow.workStartedLabel}
          arrivalSource={workflow.arrivalSource}
          customerEnRouteNotified={workflow.customerEnRouteNotified}
          customerArrivalNotified={workflow.customerArrivalNotified}
          customerEnRouteMessages={workflow.customerEnRouteMessages}
          customerArrivalMessages={workflow.customerArrivalMessages}
          customerReachable={workflow.customerReachable}
          navigateUrl={googleMapsUrl}
          phone={job.phone}
        >
          {identity}
        </JobWorkflow>
      ) : (
        // Signed out, or canceled. Both are read-only: there is no job to
        // advance, and a Start trip button that silently saves nothing is worse
        // than one that is not there.
        <section className="rounded-panel border border-line bg-surface p-4 sm:p-5">
          <div className="mb-4">{identity}</div>
          <StatusBadge status={job.status} />
          {!canceled ? (
            <a
              href={googleMapsUrl}
              target="_blank"
              rel="noreferrer"
              className="tap-target mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-control border border-brand/40 bg-brand/[0.08] text-sm font-semibold text-brand"
            >
              Navigate
            </a>
          ) : null}
        </section>
      )}

      {job.summary || job.serviceNotes || job.accessNotes ? (
        /*
         * The summary, and the intake behind it one tap away.
         *
         * Five questions were asked before this job existed — how much of the
         * house is out, whether a breaker was tried, whether anybody will be
         * home — and every one of them was landing in a booking request nobody
         * opens. They are the answers that decide what goes in the van, so they
         * belong on the line they explain.
         *
         * A `<details>` rather than a button and some state, for the reason the
         * booking-requests page gives: it works before any JavaScript arrives,
         * which on a van's signal is most of the time. The summary stays
         * readable closed, so nothing that was on this card has moved.
         */
        <section className="mt-3 rounded-panel border border-line bg-surface">
          {callRecord ? (
            <details className="group">
              <summary className="tap-target flex cursor-pointer list-none items-start justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">What the customer said</span>
                  {job.summary ? (
                    <span className="mt-2 block text-sm leading-6 text-ink-muted">
                      {job.summary}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand">
                  <span className="group-open:hidden">Read it</span>
                  <span className="hidden group-open:inline">Close</span>
                  <ChevronDown
                    className="h-4 w-4 shrink-0 transition group-open:rotate-180"
                    aria-hidden
                  />
                </span>
              </summary>

              <div className="px-4 pb-4 sm:px-5 sm:pb-5">
                <JobCallRecord record={callRecord} timeZone={messaging?.timezone ?? "UTC"} />
              </div>
            </details>
          ) : (
            // Nothing to open — a job typed in by hand has no call behind it,
            // and a disclosure onto an empty box is worse than none.
            <div className="p-4 sm:p-5">
              <h2 className="text-sm font-semibold">What the customer said</h2>
              {job.summary ? (
                <p className="mt-2 text-sm leading-6 text-ink-muted">{job.summary}</p>
              ) : null}
            </div>
          )}

          {job.serviceNotes || job.accessNotes ? (
            <div className="px-4 pb-4 sm:px-5 sm:pb-5">
              {job.serviceNotes ? (
                <p className="rounded-control bg-white/[0.03] p-3 text-sm leading-6 text-ink-muted">
                  {job.serviceNotes}
                </p>
              ) : null}
              {job.accessNotes ? (
                <p className="mt-3 flex items-start gap-2 rounded-control bg-white/[0.03] p-3 text-sm leading-6 text-ink-muted">
                  <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-caution" aria-hidden />
                  {job.accessNotes}
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/*
        The workspace: what was done, what it took, what it looked like, and
        what to remember. One card with three sections rather than three cards,
        because they are one activity and the gaps between panels were most of
        the scrolling.

        It appears on arrival. Before that none of it can be filled in from a
        van, and four empty forms between the address and the next step is
        exactly the pile this redesign is against.
      */}
      {controls && workspaceOpen ? (
        <section className="mt-3 divide-y divide-line rounded-panel border border-line bg-surface px-4 sm:px-5">
          <div className="py-4">
            <JobLinesPanel
              jobNumber={controls.jobNumber}
              lines={lines}
              totals={totals}
              stock={stock}
            />
          </div>
          <div className="py-4">
            <JobPhotos jobNumber={controls.jobNumber} photos={photos} />
          </div>
          <div className="py-4">
            <JobNotes jobNumber={controls.jobNumber} notes={controls.technicianNotes} />
          </div>
        </section>
      ) : null}

      {/*
        The texts that belong to this job, read straight from the conversation
        rather than through the inbox. Clearing a thread out of Messages is one
        person tidying a list; what was agreed with the customer about this job
        is the job's record, and it stays here either way.
      */}
      {conversations.length > 0 ? (
        <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Conversation</h2>
            <Link
              href={`/messages/${conversations[0]?.id}`}
              className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand"
            >
              Open in Messages
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {conversations.map((conversation) => (
            <div key={conversation.id} className="mt-2">
              {conversation.archived || conversation.deleted ? (
                <p className="mb-2 text-[11px] text-ink-faint">
                  {conversation.deleted ? "Deleted from the inbox" : "Archived"} · kept here in
                  full.
                </p>
              ) : null}

              <ul className="space-y-1.5">
                {conversation.messages.map((message) => (
                  <li
                    key={message.id}
                    className={`max-w-[85%] rounded-control px-3 py-2 text-sm leading-5 ${
                      message.direction === "inbound"
                        ? "bg-white/[0.04] text-ink"
                        : "ml-auto bg-brand/10 text-ink"
                    }`}
                  >
                    {message.body}
                  </li>
                ))}
              </ul>

              {conversation.messages.length === 0 ? (
                <p className="text-sm text-ink-muted">No texts on this job yet.</p>
              ) : null}
            </div>
          ))}
        </section>
      ) : null}

      {!controls ? (
        // The signed-out demo view has no job to add lines to, and a form that
        // silently fails is worse than a sentence saying why it is not there.
        <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold">Materials</h2>
            <Link
              href={`/materials?job=${job.id}`}
              className="tap-target inline-flex min-h-11 items-center gap-1 text-sm font-semibold text-brand"
            >
              {needsStop ? "Buy what is short" : "Check stock"}
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>
          {job.materials.length === 0 ? (
            <p className="mt-2 text-sm text-ink-muted">Nothing listed for this job yet.</p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {job.materials.map((material) => (
                <li key={material.name} className="flex items-center justify-between gap-3 text-sm">
                  <span className="min-w-0 truncate">{material.name}</span>
                  <span className="shrink-0 text-ink-muted">
                    {material.quantity} {material.unit}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}

      {/*
        Everything that is true about the job and is nobody's next action.
        Closed by default and open in one tap — the contract in particular was
        four hundred pixels of a page that gets opened at the top of a driveway.
      */}
      <details id="contract" className="group mt-3 rounded-panel border border-line bg-surface">
        <summary className="tap-target flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 sm:px-5 [&::-webkit-details-marker]:hidden">
          <span className="text-sm font-semibold">More job details</span>
          <ChevronDown
            className="h-4 w-4 shrink-0 text-ink-muted transition group-open:rotate-180"
            aria-hidden
          />
        </summary>

        <div className="divide-y divide-line border-t border-line px-4 sm:px-5">
          <div className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-ink-muted">On this job</p>
            {controls ? (
              <AssignTechnician jobNumber={controls.jobNumber} technician={job.technician} />
            ) : (
              <span className="text-sm">{job.technician}</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-ink-muted">Documents and photos</p>
            <Link
              href={`/files?job=${job.id}`}
              className="tap-target inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-brand"
            >
              Files
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {job.phone || job.email ? (
            <div className="py-4">
              <h3 className="text-sm font-semibold">Customer</h3>
              <p className="mt-1 text-sm text-ink-muted">{job.customer}</p>
              {job.phone ? <p className="text-sm text-ink-muted">{job.phone}</p> : null}
              {job.email ? <p className="text-sm text-ink-muted">{job.email}</p> : null}
            </div>
          ) : null}

          {controls ? (
            <div className="py-4">
              <JobContract jobNumber={controls.jobNumber} contracts={contracts} />
            </div>
          ) : null}
        </div>
      </details>

      {/*
        What has happened on this job, recorded as it happened. Below the
        details, because the details are what somebody standing at the door
        needs and this is what somebody asked "when did we tell them" needs.
      */}
      {history.rows.length > 0 ? (
        <section className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <h2 className="text-sm font-semibold">History</h2>
          <div className="mt-3">
            <ActivityTimeline
              rows={history.rows}
              timeZone={history.timeZone}
              today={todayInZone(history.timeZone)}
            />
          </div>
        </section>
      ) : null}

      {/*
        Room under the last card for the action bar, which is fixed above the
        bottom nav on a phone and would otherwise sit on top of the final row.
      */}
      {workflow && !canceled ? <div className="h-20 lg:hidden" aria-hidden /> : null}
    </FieldPageShell>
  );
}
