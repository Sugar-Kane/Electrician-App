import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, ChevronDown, ChevronRight, Link2, MapPin, ShieldAlert } from "lucide-react";

import { ActivityTimeline } from "@/components/activity-timeline";
import { FieldPageShell } from "@/components/field-page-shell";
import { SpanishBadge } from "@/components/language-badge";
import { jobNeedsMaterialStop, pilotJobs } from "@/lib/pilot-data";
import { JobContract } from "@/components/job-contract";
import { JobFollowUps } from "@/components/job-follow-ups";
import { JobCallRecord } from "@/components/job-call-record";
import { JobLinesPanel } from "@/components/job-lines-panel";
import { JobMenu } from "@/components/job-menu";
import { JobNotes } from "@/components/job-notes";
import { JobPhotos } from "@/components/job-photos";
import { DiagnosticDecision, JobStageCard } from "@/components/job-flow";
import { JobWorkflow } from "@/components/job-workflow";
import { AssignTechnician } from "@/components/assign-technician";
import { JobSource } from "@/components/ui/job-source";
import { StatusBadge } from "@/components/ui/status-badge";
import { todayInZone } from "@/lib/calendar";
import { streetWithUnit } from "@/lib/property-details";
import {
  getJob,
  getJobContracts,
  getJobControls,
  getJobFollowUps,
  getJobHistory,
} from "@/lib/job-data";
import { getJobIntake } from "@/lib/job-intake";
import { getJobConversation, getMessagingContext } from "@/lib/messaging";
import { getJobInvoices, getJobLines, getJobStock, getStockOptions } from "@/lib/job-line-data";
import { getJobPhotos } from "@/lib/job-photo-data";
import { getJobWorkflow } from "@/lib/job-workflow-data";
import { agreementChanges, unbilledCents } from "@/lib/job-billing";
import { isProgressKey, jobProgress } from "@/lib/job-progress";
import { jobFlow, visitActionLabel } from "@/lib/job-flow";
import { DIAGNOSTIC_FEE_LINE } from "@/lib/diagnostic-outcome";
import { formatCents } from "@/lib/job-lines";
import { showsWorkAndMaterials, showsWorkspace } from "@/lib/job-workflow";
import { loadJobMaterialChat } from "@/lib/material-list-server";
import { JobMaterialChat } from "@/components/job-material-chat";
import { EndVisitForReturn } from "@/components/job-visits";
import { getJobVisitsByNumber } from "@/lib/job-visits-server";

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

export default async function JobDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ jobId: string }>;
  searchParams: Promise<{ step?: string }>;
}) {
  const [{ jobId }, { step: askedStep }] = await Promise.all([params, searchParams]);
  const { job } = await getJob(jobId);
  if (!job) notFound();

  // Null for the signed-out demo view, where there is nothing real to advance.
  const [
    controls,
    workflow,
    contracts,
    { jobId: lineJobId, lines, totals },
    invoices,
    followUps,
    stock,
    photos,
    messaging,
    history,
  ] = await Promise.all([
    getJobControls(jobId),
    getJobWorkflow(jobId),
    getJobContracts(jobId),
    getJobLines(jobId),
    getJobInvoices(jobId),
    getJobFollowUps(jobId),
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

  // What has been written on the job since the customer last signed, for the
  // contract card to offer a change order for.
  const changes = agreementChanges(
    lines.map((line) => ({ createdAt: line.createdAt ?? "", quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
    contracts.map((contract) => ({
      id: contract.id,
      kind: contract.kind,
      status: contract.status,
      createdAt: contract.createdAt,
      signedAt: contract.signedAt,
    })),
  );
  const agreement = {
    signed: Boolean(changes.signed),
    addedCount: changes.added.length,
    addedCents: changes.addedCents,
    waiting: Boolean(changes.waiting),
    behind: changes.behind,
  };

  const canceled = controls?.canceled ?? job.status === "Canceled";
  const state = workflow?.state ?? "scheduled";

  // What each stock part holds back or has taken, for the lines list and for
  // "Confirm parts used" when the job is finished.
  const [stockLines, materialChat, pastVisits] = await Promise.all([
    lineJobId && controls ? getJobStock(lineJobId, !canceled && state !== "completed") : Promise.resolve([]),
    lineJobId && controls ? loadJobMaterialChat(lineJobId) : Promise.resolve(null),
    controls ? getJobVisitsByNumber(jobId) : Promise.resolve([]),
  ]);
  const lineStock = Object.fromEntries(
    stockLines.map((line) => [line.lineId, { reserved: line.reserved, taken: line.taken, itemUnit: line.itemUnit }]),
  );
  const reservedParts = stockLines
    .filter((line) => line.reserved > 0)
    .map((line) => ({
      lineId: line.lineId,
      name: line.description || line.itemName,
      quantity: line.quantity,
      taken: line.taken,
      unit: line.itemUnit,
      onHand: line.onHand,
    }));

  // The newest agreement that was not voided, as far as approval goes.
  const currentAgreement = contracts.find((contract) => contract.kind === "agreement" && contract.status !== "void");
  const progress = jobProgress({
    kindOfWork: job.kindOfWork,
    scheduledLabel: job.startsAt ? `${job.dateLabel} · ${job.time}` : "",
    scheduleHref: `/jobs/${job.id}/edit#window`,
    workflowState: state,
    pricedCents: totals.subtotalCents,
    partCount: lines.filter((line) => line.kind === "material").length,
    materialsReadyAt: controls?.materialsReadyAt ?? null,
    agreement: currentAgreement
      ? {
          signed: Boolean(currentAgreement.signedAt),
          sent: currentAgreement.status === "sent" || Boolean(currentAgreement.sentLabel),
        }
      : null,
    invoices: invoices.map((invoice) => ({
      status: invoice.status,
      lastSentAt: invoice.lastSentAt,
      paidAt: invoice.paidAt,
      previewSentAt: invoice.previewSentAt,
    })),
    unbilledCents: unbilledCents(
      lines.map((line) => ({ invoiceId: line.invoiceId ?? null, quantity: line.quantity, unitPriceCents: line.unitPriceCents })),
      invoices,
    ),
    formatMoney: formatCents,
  });
  // The step a job card was tapped on, opened here with what finishes it.
  const initialStep = isProgressKey(askedStep) ? askedStep : null;

  // The materials list as it stands, for whether a work order still needs
  // quotes: items with no store price matched yet.
  const listItems = (materialChat?.saved.list.sections ?? []).flatMap((section) =>
    section.blocks.flatMap((block) => (block.type === "items" ? block.items : [])),
  );
  const unpricedItems = listItems.filter(
    (item) => !item.prices || !Object.keys(item.prices).some((key) => key !== "use"),
  ).length;

  // The diagnostic's own fee, still owed: not paid at booking, not a follow-up.
  const diagnosticFeeDue = Boolean(
    controls && controls.diagnostic.feeCents > 0 && !controls.diagnostic.paid && !controls.diagnostic.followUp,
  );
  const stage = jobFlow({
    kindOfWork: job.kindOfWork,
    workflowState: state,
    scheduled: Boolean(job.startsAt),
    scheduleHref: `/jobs/${job.id}/edit#window`,
    progress: progress.steps,
    lineCount: lines.length,
    partCount: lines.filter((line) => line.kind === "material").length,
    materialListCount: listItems.length,
    unpricedMaterialCount: unpricedItems,
    materialsReady: Boolean(controls?.materialsReadyAt),
    agreement: currentAgreement
      ? {
          signed: Boolean(currentAgreement.signedAt),
          sent: currentAgreement.status === "sent" || Boolean(currentAgreement.sentLabel),
        }
      : null,
    followUpCount: followUps.booked.length,
    diagnosticFeeDue,
    canceled,
  });
  const primaryHref = stage.primary.kind === "go" ? stage.primary.href : "";
  // Hours, parts and billing are on screen whenever they are the next step.
  // A diagnostic with nothing on it but its fee (diagnostic only, or not
  // decided yet) buys no materials, so they stay folded until a repair is.
  const repairLineCount = lines.filter((line) => line.description !== DIAGNOSTIC_FEE_LINE).length;
  const materialsFolded = stage.flow === "diagnostic" && repairLineCount === 0;
  const linesStepOpen =
    primaryHref === "#work-materials" ||
    primaryHref === "#billing" ||
    (stage.needsDecision && !materialsFolded) ||
    initialStep === "estimate" ||
    initialStep === "materials" ||
    initialStep === "invoice" ||
    initialStep === "paid";
  const workspaceOpen = showsWorkspace(state) && !canceled;

  const agreementState = currentAgreement
    ? currentAgreement.signedAt
      ? "Signed"
      : currentAgreement.status === "sent" || currentAgreement.sentLabel
        ? "Sent, waiting to sign"
        : "Drafted, not sent"
    : "Pending";
  const approvalSummary = currentAgreement ? `Customer authorization: ${agreementState.toLowerCase()}` : "No estimate sent yet";
  // Hours, parts and the invoice: with the workspace, and on a work order from
  // the moment it is booked, without starting it or texting anybody.
  const workAndMaterialsOpen =
    (showsWorkAndMaterials(state, job.kindOfWork === "Work order") || linesStepOpen) && !canceled;

  /*
   * Booking the work a diagnostic found.
   *
   * Offered once the visit is under way — before that there is nothing found
   * to book — and shown whenever something has been booked from it, whatever
   * state the diagnostic is in. Also in the ••• menu, for the owner who knows
   * from the photos before anybody has driven out.
   */
  const diagnostic = Boolean(controls) && job.kindOfWork === "Diagnostic" && !canceled;
  const showFollowUps = diagnostic && (workspaceOpen || followUps.booked.length > 0);

  // The facts a job is priced and agreed on. A diagnostic is its fee; a work
  // order is its scope, its quotes and the customer's say-so.
  const serviceDetails: { label: string; value: string }[] =
    job.kindOfWork === "Diagnostic"
      ? [
          { label: "Service type", value: "Diagnostic service call" },
          {
            label: "Diagnostic fee",
            value: controls?.diagnostic.feeCents
              ? `${formatCents(controls.diagnostic.feeCents)}${controls.diagnostic.paid ? " · paid" : ""}`
              : "No fee",
          },
          {
            label: "Repair estimate",
            value:
              followUps.booked.length > 0
                ? `Work order #${followUps.booked[0].jobNumber}`
                : "After diagnosis",
          },
        ]
      : [
          { label: "Service type", value: job.workType.replace(/_/g, " ") || "Work order" },
          {
            label: "Material quotes",
            value:
              lines.length > 0
                ? `Priced · ${formatCents(totals.subtotalCents)}`
                : listItems.length > 0
                  ? unpricedItems > 0
                    ? `${unpricedItems} of ${listItems.length} still to price`
                    : "Priced, not on the job yet"
                  : "Required before visit",
          },
          { label: "Customer authorization", value: agreementState },
        ];

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
      {/* The visit that found this work, one tap back. */}
      {followUps.followsUp ? (
        <Link
          href={`/jobs/${followUps.followsUp.jobNumber}`}
          className="tap-target mt-0.5 inline-flex min-h-9 items-center gap-1.5 text-sm font-semibold text-brand"
        >
          <Link2 className="h-4 w-4" aria-hidden />
          Follow-up to {followUps.followsUp.kindOfWork.toLowerCase()} #{followUps.followsUp.jobNumber}
        </Link>
      ) : null}
      {/* No time yet is said once, by the status below, not as " · –". */}
      {job.startsAt ? (
        <p className="mt-0.5 text-sm text-ink-muted">
          {job.dateLabel} · {job.time}–{job.endTime}
        </p>
      ) : null}
      {hasAddress ? (
        <p className="mt-2 flex items-start gap-2 text-base font-medium leading-6">
          <MapPin className="mt-1 h-4 w-4 shrink-0 text-ink-muted" aria-hidden />
          <span>
            {streetWithUnit(job.address, job.unit ?? "")}
            {job.city ? <span className="block text-ink-muted">{job.city}</span> : null}
          </span>
        </p>
      ) : null}
      {/* The gate code gets learned at the gate, so it is one tap from here. */}
      {controls && hasAddress && !canceled ? (
        <Link
          href={`/jobs/${job.id}/edit#place`}
          className="tap-target mt-1 inline-flex min-h-11 items-center text-sm font-semibold text-brand"
        >
          {job.unit || job.accessNotes ? "Edit apt & access notes" : "Add apt & access notes"}
        </Link>
      ) : null}
    </div>
  );

  return (
    <FieldPageShell
      compact
      title={job.contactName || job.customer}
      titleBadge={<SpanishBadge language={job.customerLanguage} />}
      eyebrow={`Job #${job.id}`}
      backHref="/jobs"
      action={
        controls ? (
          <JobMenu
            jobNumber={controls.jobNumber}
            hasContract={contracts.length > 0}
            canBookWorkOrder={diagnostic}
          />
        ) : null
      }
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

      {controls && !canceled ? <JobStageCard stage={stage} jobNumber={controls.jobNumber} canEndVisit={state === "arrived" || state === "working" || state === "review"} /> : null}

      <div id="work" className="scroll-mt-24">
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
          unscheduled={!job.startsAt}
          reservedParts={reservedParts}
          actionLabel={visitActionLabel(stage.flow, state)}
          holdPrimary={stage.primary.kind !== "visit" && state === "scheduled"}
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
      </div>

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
        <section id="request" className="mt-3 scroll-mt-24 rounded-panel border border-line bg-surface">
          {callRecord ? (
            <details className="group">
              <summary className="tap-target flex cursor-pointer list-none items-start justify-between gap-3 p-4 sm:p-5 [&::-webkit-details-marker]:hidden">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold">Customer request</span>
                  {job.summary ? (
                    <span className="mt-2 block text-sm leading-6 text-ink-muted">
                      {job.summary}
                    </span>
                  ) : null}
                </span>
                <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-brand">
                  <span className="group-open:hidden">Intake</span>
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
              <h2 className="text-sm font-semibold">Customer request</h2>
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
                  {/* Line breaks kept: the gate code and the dog read as two things. */}
                  <span className="min-w-0 whitespace-pre-line">{job.accessNotes}</span>
                </p>
              ) : null}
            </div>
          ) : null}
        </section>
      ) : null}

      {/* What kind of job this is and what it is priced on, at a glance. */}
      {controls && !canceled ? (
        <section aria-labelledby="service-heading" className="mt-3 rounded-panel border border-line bg-surface p-4 sm:p-5">
          <h2 id="service-heading" className="text-sm font-semibold">
            Service details
          </h2>
          <dl className="mt-2 divide-y divide-line text-sm">
            {serviceDetails.map((row) => (
              <div key={row.label} className="flex items-start justify-between gap-4 py-2.5">
                <dt className="text-ink-muted">{row.label}</dt>
                <dd className="min-w-0 text-right font-semibold">{row.value}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
            Source <JobSource channel={job.channel} />
          </p>
        </section>
      ) : null}

      {/*
        Everything else, one row each, closed until it is wanted: a row opens
        by itself when it holds the next step, and the progress card's button
        opens it on the way there. `<details>` so it works before any
        JavaScript arrives.
      */}
      {controls && workspaceOpen ? (
        <SectionRow
          id="findings"
          title={stage.flow === "diagnostic" ? "Diagnostic findings" : "Work & checklists"}
          summary={stage.needsDecision ? "Photos, notes and what happens next" : "Photos and notes from the visit"}
          open={state === "working" || state === "review" || (stage.needsDecision && !canceled)}
        >
          <div className="divide-y divide-line">
            {/* What the visit found decides how it ends, so the choice sits
                with the photos and notes that show it. */}
            {stage.needsDecision && !canceled ? (
              <div className="pb-4">
                <DiagnosticDecision
                  embedded
                  jobNumber={controls.jobNumber}
                  completed={state === "completed"}
                  feeLabel={controls.diagnostic.feeCents > 0 ? formatCents(controls.diagnostic.feeCents) : ""}
                  feeDue={diagnosticFeeDue}
                />
              </div>
            ) : null}
            <div className={stage.needsDecision && !canceled ? "py-4" : "pb-4"}>
              <JobPhotos jobNumber={controls.jobNumber} photos={photos} />
            </div>
            <div className="pt-4">
              <JobNotes jobNumber={controls.jobNumber} notes={controls.technicianNotes} />
            </div>
          </div>
        </SectionRow>
      ) : null}

      {showFollowUps && controls ? (
        <SectionRow
          id="repairs"
          title="Repair work orders"
          summary={
            followUps.booked.length === 0
              ? "None booked yet"
              : `${followUps.booked.length} booked`
          }
          open={followUps.booked.length > 0}
        >
          <div className="[&>section]:mt-0 [&>section]:rounded-none [&>section]:border-0 [&>section]:bg-transparent [&>section]:p-0">
            <JobFollowUps
              jobNumber={controls.jobNumber}
              booked={followUps.booked}
              creditCents={followUps.creditCents}
            />
          </div>
        </SectionRow>
      ) : null}

      {controls && workAndMaterialsOpen ? (
        <SectionRow
          id="work-materials"
          title={stage.flow === "diagnostic" ? "Materials & labor" : "Materials & supplier quotes"}
          summary={
            lines.length > 0
              ? `${lines.length} ${lines.length === 1 ? "line" : "lines"} · ${formatCents(totals.subtotalCents)}`
              : listItems.length > 0
                ? `${listItems.length} on the list${unpricedItems > 0 ? `, ${unpricedItems} unpriced` : ""}`
                : "Nothing listed yet"
          }
          open={linesStepOpen || (workspaceOpen && !materialsFolded)}
        >
          <div className="divide-y divide-line">
          {materialChat ? (
            <div className="py-4">
              <JobMaterialChat
                jobNumber={controls.jobNumber}
                saved={materialChat.saved}
                markupPercent={materialChat.markupPercent}
                forChatGpt={materialChat.forChatGpt}
                jobDescription={job.summary}
                hasLines={lines.length > 0}
                startFolded={materialsFolded}
              />
            </div>
          ) : null}
          <div className="py-4">
            <JobLinesPanel
              jobNumber={controls.jobNumber}
              lines={lines}
              totals={totals}
              invoices={invoices}
              stock={stock}
              lineStock={lineStock}
              billing={{
                jobCompleted: state === "completed",
                agreementSigned: Boolean(currentAgreement?.signedAt),
                hasPhone: Boolean(job.phone),
                hasEmail: Boolean(job.email),
              }}
            />
          </div>
          </div>
        </SectionRow>
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

      {controls && stage.flow === "work_order" ? (
        <SectionRow
          title="Estimate & approval"
          summary={approvalSummary}
          open={primaryHref === "#contract" || initialStep === "approval"}
        >
          <JobContract
            jobNumber={controls.jobNumber}
            contracts={contracts}
            customerName={job.contactName || job.customer}
            customerPhone={job.phone}
            changes={agreement}
          />
        </SectionRow>
      ) : null}

      {controls && !canceled ? (
        <SectionRow
          id="visits"
          title="Visits"
          summary={`${pastVisits.length + 1} ${pastVisits.length === 0 ? "visit" : "visits"} · next ${
            job.startsAt ? `${job.dateLabel} · ${job.time}` : "not scheduled yet"
          }`}
          open={pastVisits.length > 0 && !showsWorkspace(state)}
        >
          <ol className="space-y-2 text-sm">
            {pastVisits.map((visit, index) => (
              <li key={visit.id} className="rounded-control border border-line px-3 py-2.5">
                <span className="block font-semibold">
                  Visit {index + 1} · {visitDay(visit.arrivedAt || visit.windowStart || visit.endedAt, history.timeZone)}
                </span>
                <span className="block text-ink-muted">
                  {visit.arrivedAt ? `Arrived ${visitTime(visit.arrivedAt, history.timeZone)} · ` : ""}
                  Ended {visitTime(visit.endedAt, history.timeZone)}
                </span>
                {visit.note ? <span className="mt-1 block whitespace-pre-line leading-6">{visit.note}</span> : null}
              </li>
            ))}
            <li className="flex items-center justify-between gap-3 rounded-control border border-brand/40 px-3 py-2.5">
              <span>
                <span className="block font-semibold">
                  {pastVisits.length > 0 ? `Visit ${pastVisits.length + 1} · ` : ""}
                  {job.startsAt ? job.dateLabel : "No time set"}
                </span>
                {job.startsAt ? (
                  <span className="block text-ink-muted">
                    {job.time}–{job.endTime}
                    {showsWorkspace(state) && state !== "completed" ? " · under way" : ""}
                  </span>
                ) : null}
              </span>
              {!showsWorkspace(state) ? (
                <Link
                  href={`/jobs/${job.id}/edit#window`}
                  className="tap-target inline-flex min-h-11 items-center text-sm font-semibold text-brand"
                >
                  {job.startsAt ? "Change time" : "Schedule"}
                </Link>
              ) : null}
            </li>
          </ol>
          {state === "arrived" || state === "working" || state === "review" ? (
            <div className="mt-4 border-t border-line pt-4">
              <EndVisitForReturn jobNumber={controls.jobNumber} timeZone={history.timeZone} canText={Boolean(job.phone)} />
            </div>
          ) : null}
        </SectionRow>
      ) : null}

      <SectionRow
        title={stage.flow === "diagnostic" ? "Documents & contract" : "Documents & job details"}
        summary="Assignment, files and contact"
        open={stage.flow === "diagnostic" && (primaryHref === "#contract" || initialStep === "approval")}
      >
        {controls && stage.flow === "diagnostic" ? (
          <div className="mb-2 border-b border-line pb-4">
            <JobContract
              jobNumber={controls.jobNumber}
              contracts={contracts}
              customerName={job.contactName || job.customer}
              customerPhone={job.phone}
              changes={agreement}
            />
          </div>
        ) : null}
        <div className="divide-y divide-line ">
          <div className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-ink-muted">Assigned to</p>
            {controls ? (
              <AssignTechnician jobNumber={controls.jobNumber} technician={job.technician} />
            ) : (
              <span className="text-sm">{job.technician}</span>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 py-4">
            <p className="text-sm text-ink-muted">Attachments</p>
            <Link
              href={`/files?job=${job.id}`}
              className="tap-target inline-flex min-h-11 shrink-0 items-center gap-1 text-sm font-semibold text-brand"
            >
              View files
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Link>
          </div>

          {job.phone || job.email ? (
            <div className="py-4">
              <h3 className="text-sm font-semibold">Contact</h3>
              {job.phone ? <p className="text-sm text-ink-muted">{job.phone}</p> : null}
              {job.email ? <p className="text-sm text-ink-muted">{job.email}</p> : null}
            </div>
          ) : null}

        </div>
      </SectionRow>

      {conversations.length > 0 || history.rows.length > 0 ? (
        <SectionRow title="Activity & history" summary="Texts and everything that happened on this job">
          {conversations.length > 0 ? (
            <div>
              <h3 className="text-sm font-semibold">Conversation</h3>
          <div className="flex items-center justify-between gap-3">
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
            </div>
          ) : null}
          {history.rows.length > 0 ? (
            <div className={conversations.length > 0 ? "mt-4 border-t border-line pt-4" : ""}>
              <h3 className="text-sm font-semibold">History</h3>
          <div className="mt-3">
            <ActivityTimeline
              rows={history.rows}
              timeZone={history.timeZone}
              today={todayInZone(history.timeZone)}
            />
          </div>
            </div>
          ) : null}
        </SectionRow>
      ) : null}

      {/*
        Room under the last card for the action bar, which is fixed above the
        bottom nav on a phone and would otherwise sit on top of the final row.
      */}
      {workflow && !canceled ? <div className="h-20 lg:hidden" aria-hidden /> : null}
    </FieldPageShell>
  );
}

/**
 * One collapsible row of the job page: a title, a line saying what is in it,
 * and the section itself when opened. Closed unless it holds the next step.
 */
function SectionRow({
  id,
  title,
  summary,
  open = false,
  children,
}: {
  id?: string;
  title: string;
  summary?: string;
  open?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details id={id} open={open} className="group mt-3 scroll-mt-24 rounded-panel border border-line bg-surface">
      <summary className="tap-target flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 sm:px-5 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-sm font-semibold">{title}</span>
          {summary ? <span className="mt-0.5 block truncate text-xs text-ink-muted">{summary}</span> : null}
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-ink-muted transition group-open:rotate-180" aria-hidden />
      </summary>
      <div className="border-t border-line px-4 py-4 sm:px-5">{children}</div>
    </details>
  );
}

function visitDay(iso: string, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso));
}

function visitTime(iso: string, timeZone: string): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit" }).format(new Date(iso));
}
